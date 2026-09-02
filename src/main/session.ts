import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { abs } from './workspace/paths'
import { createEngine as defaultCreateEngine } from './engine'
import {
  loadSessionMeta,
  loadDocument,
  writeDocument,
  setSectionStatus,
  resolveModel,
  loadWorkspaceConfig,
  appendTranscript
} from './workspace/workspace'
import { getTemplate } from './templates/templates'
import { getHat } from './hats/hats'
import { resolveContext } from './context/resolve'
import { updateSectionBody } from './document/document'
import type {
  AgentEngine,
  EngineEvent,
  EngineKind,
  RunRequest,
  SectionStatus,
  SectionTemplate,
  SessionDoc,
  SessionMeta
} from '../shared/types'

export async function runSessionPrompt(
  root: string,
  sessionId: string,
  prompt: string,
  emit: (e: EngineEvent) => void,
  deps: { createEngine?: (k: EngineKind) => AgentEngine } = {}
): Promise<void> {
  const meta: SessionMeta = JSON.parse(
    await readFile(join(abs(root, sessionId), 'session.json'), 'utf8')
  )
  const engine = (deps.createEngine ?? defaultCreateEngine)(meta.engine)
  for await (const ev of engine.run({ prompt, cwd: abs(root, sessionId) })) emit(ev)
}

// Dependency-injection seam so section generation is unit-testable with a fake
// engine. Mirrors runSessionPrompt's `deps.createEngine`. `signal` lets a caller
// (wf:interrupt) abort a generateAll run between sections.
export interface GenerateDeps {
  createEngine?: (k: EngineKind) => AgentEngine
  signal?: AbortSignal
}

// Section-scoped stream message (main → renderer). `event` carries raw engine
// events (deltas, tool use, turn_end, ...); `status` carries lifecycle changes.
// The IPC layer fans these out to the wf:sectionEvent / wf:sectionStatus
// channels respectively.
export type SectionMessage =
  { type: 'event'; event: EngineEvent } | { type: 'status'; status: SectionStatus }

// Generate a single section's body with its hat. Loads meta + document, resolves
// the hat and context recipe from the template, runs the engine, streams deltas
// into a body buffer, and on turn_end persists the body + flips status to ready.
// On error (thrown or an error event) the section status becomes 'error'.
export async function generateSection(
  root: string,
  sessionId: string,
  sectionId: string,
  emit: (m: SectionMessage) => void,
  deps: GenerateDeps = {}
): Promise<void> {
  const meta = await loadSessionMeta(root, sessionId)
  if (!meta) throw new Error(`session not found: ${sessionId}`)
  const doc = await loadDocument(root, sessionId)
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section) throw new Error(`section not found: ${sectionId}`)

  const template = getTemplate(meta.templateId)
  const templateSection = template?.sections.find((s) => s.id === sectionId)
  const hat = getHat(section.hat)

  // Session goal: use the session name until a dedicated goal field lands.
  const contextBundle = resolveContext(templateSection?.context, doc, meta.name)
  const workspaceConfig = await loadWorkspaceConfig(root)
  const model = resolveModel(meta, sectionId, hat, workspaceConfig.defaultModel)

  const formatHint =
    section.format === 'html'
      ? 'Respond with ONLY the section body as clean semantic HTML (no <html>/<body> wrapper, no markdown fences).'
      : 'Respond with ONLY the section body as GitHub-flavored Markdown (no surrounding code fence).'
  const promptParts = [
    `Produce the "${section.title || sectionId}" section (${section.type}) for this session.`,
    formatHint
  ]
  if (contextBundle) promptParts.push(`\n--- Context ---\n${contextBundle}`)
  const prompt = promptParts.join('\n')

  await setSectionStatus(root, sessionId, sectionId, 'generating')
  emit({ type: 'status', status: 'generating' })

  const req: RunRequest = {
    prompt,
    model,
    systemPrompt: hat?.systemPrompt,
    allowedTools: hat?.allowedTools,
    cwd: abs(root, sessionId),
    contextBundle
  }
  const engine = (deps.createEngine ?? defaultCreateEngine)(hat?.engine ?? meta.engine)

  let body = ''
  // `settled` guards against a non-terminal stream end (e.g. the CLI closes with
  // exit code null on SIGTERM interrupt, emitting neither turn_end nor error) —
  // without it the section would stay stuck 'generating'. `errored` guards
  // against the real CLI ordering where an 'error' is always followed by a
  // 'turn_end': the turn_end must not clobber the doc or flip to 'ready'.
  let settled = false
  let errored = false
  try {
    for await (const ev of engine.run(req)) {
      emit({ type: 'event', event: ev })
      await appendTranscript(root, sessionId, ev)
      if (ev.kind === 'text_delta') {
        body += ev.text
      } else if (ev.kind === 'turn_end') {
        if (!errored) {
          await writeDocument(root, sessionId, updateSectionBody(doc, sectionId, body))
          await setSectionStatus(root, sessionId, sectionId, 'ready')
          emit({ type: 'status', status: 'ready' })
        }
        settled = true
      } else if (ev.kind === 'error') {
        errored = true
        await setSectionStatus(root, sessionId, sectionId, 'error')
        emit({ type: 'status', status: 'error' })
        settled = true
      }
    }
  } catch (err) {
    await setSectionStatus(root, sessionId, sectionId, 'error')
    emit({ type: 'status', status: 'error' })
    throw err
  }

  // Non-terminal stream end (interrupt / abrupt close): recover off 'generating'
  // so the renderer and session.json don't stay stuck.
  if (!settled) {
    await setSectionStatus(root, sessionId, sectionId, 'error')
    emit({ type: 'status', status: 'error' })
  }
}

// Topologically order a document's sections so each section is generated after
// the sections it depends on (template.dependencies). Cycles/unknown deps are
// tolerated: a `visiting` guard breaks cycles, and deps not present in the doc
// are skipped.
function orderSections(doc: SessionDoc, template: SectionTemplate | null): string[] {
  const ids = doc.sections.map((s) => s.id)
  const idSet = new Set(ids)
  const deps = template?.dependencies ?? {}
  const done = new Set<string>()
  const visiting = new Set<string>()
  const order: string[] = []
  const visit = (id: string): void => {
    if (done.has(id) || visiting.has(id)) return
    visiting.add(id)
    for (const d of deps[id] ?? []) if (idSet.has(d)) visit(d)
    visiting.delete(id)
    done.add(id)
    order.push(id)
  }
  for (const id of ids) visit(id)
  return order
}

// Generate every section sequentially in dependency order (depended-upon
// sections first). `emit` is tagged with the section id each message belongs to.
export async function generateAll(
  root: string,
  sessionId: string,
  emit: (sectionId: string, m: SectionMessage) => void,
  deps: GenerateDeps = {}
): Promise<void> {
  const meta = await loadSessionMeta(root, sessionId)
  if (!meta) throw new Error(`session not found: ${sessionId}`)
  const doc = await loadDocument(root, sessionId)
  const order = orderSections(doc, getTemplate(meta.templateId))
  for (const sectionId of order) {
    // Stop between sections if the run was interrupted (wf:interrupt).
    if (deps.signal?.aborted) break
    await generateSection(root, sessionId, sectionId, (m) => emit(sectionId, m), deps)
  }
}
