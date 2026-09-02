import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { abs } from './workspace/paths'
import { createEngine as defaultCreateEngine } from './engine'
import {
  loadSessionMeta,
  loadDocument,
  writeDocument,
  setSectionStatus,
  resolveModel,
  loadWorkspaceConfig,
  appendTranscript,
  appendDocumentSection,
  upsertThread,
  appendThreadMessage,
  setThreadStatus,
  markDependentsStale
} from './workspace/workspace'
import { getTemplate } from './templates/templates'
import { getHat } from './hats/hats'
import { resolveContext } from './context/resolve'
import { updateSectionBody } from './document/document'
import type {
  AgentEngine,
  AskIntent,
  AskRequest,
  EngineEvent,
  EngineKind,
  RunRequest,
  Section,
  SectionStatus,
  SectionTemplate,
  SessionDoc,
  SessionMeta,
  Thread,
  ThreadMessage
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
// `stale` carries the ids of OTHER sections invalidated by this run (dependents
// re-staled after a refresh/regeneration). The IPC layer fans these out to the
// wf:sectionEvent / wf:sectionStatus channels respectively.
export type SectionMessage =
  | { type: 'event'; event: EngineEvent }
  | { type: 'status'; status: SectionStatus }
  | { type: 'stale'; sectionIds: string[] }

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
          // Refreshing/regenerating this section invalidates the sections that
          // read it — stale them explicitly (spec §6: explicit, never silent) and
          // surface the ids so the renderer flips them. markDependentsStale skips
          // 'empty'/'generating', so first-time "Generate all" (dependents still
          // empty) stales nothing.
          const staled = await markDependentsStale(root, sessionId, sectionId)
          if (staled.length) emit({ type: 'stale', sectionIds: staled })
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

// Re-run a section's owning hat with the CURRENT context bundle. Dependencies
// have (potentially) changed since the last run; because resolveContext re-reads
// the live sibling bodies at run time, refreshing simply re-runs generateSection,
// which flips generating→ready (clearing any 'stale'/'error' state) and reuses
// the whole streaming / atomic-write / transcript machinery.
export async function refreshSection(
  root: string,
  sessionId: string,
  sectionId: string,
  emit: (m: SectionMessage) => void,
  deps: GenerateDeps = {}
): Promise<void> {
  await generateSection(root, sessionId, sectionId, emit, deps)
}

// Re-run every section currently 'stale' or 'error' in dependency order (so an
// upstream section is refreshed before the dependents that read it). Skips
// sections in any other state. Cancellable between sections via deps.signal.
// When a section reaches ready, generateSection re-stales its dependents; because
// dependents come LATER in dependency order and the status is re-read fresh each
// iteration, a dependent staled by an upstream refresh in THIS pass IS picked up
// and regenerated (an intentional single-pass cascade, bounded by the topo order
// so each section runs at most once).
export async function refreshAll(
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
    if (deps.signal?.aborted) break
    // Read the status fresh each iteration so a dependent staled by an earlier
    // refresh in this same pass IS seen and regenerated (single-pass cascade).
    const current = await loadSessionMeta(root, sessionId)
    const status = current?.sectionStatus?.[sectionId]
    if (status !== 'stale' && status !== 'error') continue
    await generateSection(root, sessionId, sectionId, (m) => emit(sectionId, m), deps)
  }
}

// The precanned instruction appended to an ask prompt for each intent.
const ASK_INSTRUCTIONS: Record<AskIntent, string> = {
  'add-detail':
    'The user wants MORE DETAIL on the selected text. Rewrite the ENTIRE section body, preserving everything else verbatim and only expanding the selected portion. Return ONLY the full updated section body.',
  disagree:
    'The user DISAGREES with the selected text. Weigh the objection, then either defend the point or propose a revision. Answer conversationally; do NOT return a full section body.',
  explain:
    'The user wants you to EXPLAIN the selected text — the reasoning behind it and why it is stated this way. Answer conversationally; do NOT return a full section body.',
  expand:
    'Produce a NEW, standalone section that expands on the selected text with deeper coverage. Return ONLY the new section body.',
  free: 'Respond to the user request below concerning the selected text. Answer conversationally.'
}

function formatHintFor(section: Section): string {
  return section.format === 'html'
    ? 'Respond with clean semantic HTML (no <html>/<body> wrapper, no markdown fences).'
    : 'Respond with GitHub-flavored Markdown (no surrounding code fence).'
}

// Build the scoped prompt for an ask: the intent instruction + the verbatim
// selected text + the user's free text + the current section body + resolved
// context. `bodyHint` toggles the output-format guidance (body-producing intents
// only).
function buildAskPrompt(
  section: Section,
  ask: AskRequest,
  contextBundle: string,
  bodyHint: boolean
): string {
  const parts = [ASK_INSTRUCTIONS[ask.intent]]
  if (bodyHint) parts.push(formatHintFor(section))
  if (ask.selectedText.trim()) parts.push(`\nSelected text:\n"""\n${ask.selectedText}\n"""`)
  if (ask.freeText && ask.freeText.trim()) parts.push(`\nUser note:\n${ask.freeText.trim()}`)
  parts.push(
    `\n--- Current section "${section.title || section.id}" (${section.type}) ---\n${section.body}`
  )
  if (contextBundle) parts.push(`\n--- Context ---\n${contextBundle}`)
  return parts.join('\n')
}

// Messages emitted by askSection. The IPC layer fans these out: 'section' →
// wf:sectionEvent/wf:sectionStatus, 'stale' → wf:sectionStatus(stale),
// 'docChanged' → wf:docChanged, thread* → wf:threadEvent/wf:threadStatus.
export type AskMessage =
  | { type: 'threadCreated'; thread: Thread }
  | { type: 'threadEvent'; threadId: string; event: EngineEvent }
  | { type: 'threadStatus'; threadId: string; status: Thread['status'] }
  | { type: 'section'; sectionId: string; message: SectionMessage }
  | { type: 'docChanged' }
  | { type: 'stale'; sectionIds: string[] }

// Resolve the engine run parameters (hat, model, system prompt, tools, context)
// for a section — shared by generate and ask flows.
async function resolveRun(
  root: string,
  meta: SessionMeta,
  doc: SessionDoc,
  section: Section
): Promise<{
  engineKind: EngineKind
  req: Pick<RunRequest, 'model' | 'systemPrompt' | 'allowedTools' | 'contextBundle'>
  contextBundle: string
}> {
  const template = getTemplate(meta.templateId)
  const templateSection = template?.sections.find((s) => s.id === section.id)
  const hat = getHat(section.hat)
  const contextBundle = resolveContext(templateSection?.context, doc, meta.name)
  const workspaceConfig = await loadWorkspaceConfig(root)
  const model = resolveModel(meta, section.id, hat, workspaceConfig.defaultModel)
  return {
    engineKind: hat?.engine ?? meta.engine,
    contextBundle,
    req: {
      model,
      systemPrompt: hat?.systemPrompt,
      allowedTools: hat?.allowedTools,
      contextBundle
    }
  }
}

// Ask a scoped question about a section (P2). Routes by ask.intent:
//   'expand'     → append an empty section after this one and stream a fresh
//                  generation into it (a new cell over wf:sectionEvent).
//   'add-detail' → stream a full-body rewrite back INTO this section, persist it,
//                  and mark dependents stale.
//   otherwise    → run a section-scoped Thread turn: create a Thread, stream the
//                  agent's answer (wf:threadEvent), append the answer message and
//                  flip the thread status ready/error (wf:threadStatus).
// Runs under the caller's DI seam (deps.createEngine → fake engine in tests) and
// deps.signal (wf:interrupt cancels a turn), mirroring generateSection.
export async function askSection(
  root: string,
  sessionId: string,
  sectionId: string,
  ask: AskRequest,
  emit: (m: AskMessage) => void,
  deps: GenerateDeps = {}
): Promise<void> {
  const meta = await loadSessionMeta(root, sessionId)
  if (!meta) throw new Error(`session not found: ${sessionId}`)
  const doc = await loadDocument(root, sessionId)
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section) throw new Error(`section not found: ${sectionId}`)

  const cwd = abs(root, sessionId)

  if (ask.intent === 'expand') {
    // New cell: append an empty section, tell the renderer to reload, then
    // generate into it with the ask-scoped prompt.
    const { doc: nextDoc, newSectionId } = await appendDocumentSection(
      root,
      sessionId,
      {
        type: section.type,
        title: `${section.title || section.id} (expanded)`,
        hat: section.hat,
        format: section.format
      },
      sectionId
    )
    emit({ type: 'docChanged' })
    const newSection = nextDoc.sections.find((s) => s.id === newSectionId)!
    const { engineKind, req, contextBundle } = await resolveRun(root, meta, doc, section)
    const prompt = buildAskPrompt(section, ask, contextBundle, true)
    const engine = (deps.createEngine ?? defaultCreateEngine)(engineKind)
    await streamIntoSection(
      root,
      sessionId,
      newSection,
      nextDoc,
      { ...req, prompt, cwd },
      engine,
      emit,
      { markStale: false }
    )
    return
  }

  if (ask.intent === 'add-detail') {
    // In-place: rewrite the section body, then stale dependents.
    const { engineKind, req, contextBundle } = await resolveRun(root, meta, doc, section)
    const prompt = buildAskPrompt(section, ask, contextBundle, true)
    const engine = (deps.createEngine ?? defaultCreateEngine)(engineKind)
    await streamIntoSection(root, sessionId, section, doc, { ...req, prompt, cwd }, engine, emit, {
      markStale: true
    })
    return
  }

  // Thread turn (disagree / explain / free).
  const { engineKind, req, contextBundle } = await resolveRun(root, meta, doc, section)
  const prompt = buildAskPrompt(section, ask, contextBundle, false)
  const engine = (deps.createEngine ?? defaultCreateEngine)(engineKind)

  const now = new Date().toISOString()
  const threadId = randomUUID()
  const userMsg: ThreadMessage = {
    id: randomUUID(),
    role: 'user',
    text: (ask.freeText && ask.freeText.trim()) || ask.intent,
    ts: now
  }
  const thread: Thread = {
    id: threadId,
    sectionId,
    anchor: ask.anchor ?? undefined,
    kind: ask.intent,
    status: 'generating',
    createdAt: now,
    updatedAt: now,
    messages: [userMsg]
  }
  await upsertThread(root, sessionId, thread)
  emit({ type: 'threadCreated', thread })
  emit({ type: 'threadStatus', threadId, status: 'generating' })

  let answer = ''
  let errored = false
  let settled = false
  try {
    for await (const ev of engine.run({ ...req, prompt, cwd })) {
      emit({ type: 'threadEvent', threadId, event: ev })
      await appendTranscript(root, sessionId, ev, { sectionId, threadId })
      if (ev.kind === 'text_delta') {
        answer += ev.text
      } else if (ev.kind === 'turn_end') {
        if (!errored) {
          await appendThreadMessage(root, sessionId, threadId, {
            id: randomUUID(),
            role: 'agent',
            text: answer,
            ts: new Date().toISOString(),
            usage: ev.usage
          })
          await setThreadStatus(root, sessionId, threadId, 'ready')
          emit({ type: 'threadStatus', threadId, status: 'ready' })
        }
        settled = true
      } else if (ev.kind === 'error') {
        errored = true
        await setThreadStatus(root, sessionId, threadId, 'error')
        emit({ type: 'threadStatus', threadId, status: 'error' })
        settled = true
      }
    }
  } catch (err) {
    await setThreadStatus(root, sessionId, threadId, 'error')
    emit({ type: 'threadStatus', threadId, status: 'error' })
    throw err
  }
  if (!settled) {
    await setThreadStatus(root, sessionId, threadId, 'error')
    emit({ type: 'threadStatus', threadId, status: 'error' })
  }
}

// Stream an engine run into a target section's body (used by ask 'expand' and
// 'add-detail'). Mirrors generateSection's error/turn_end/interrupt semantics:
// deltas accumulate, a non-errored turn_end writes the body + flips 'ready' (and,
// when markStale, stales dependents), an error keeps the doc untouched, and a
// non-terminal end recovers off 'generating'.
async function streamIntoSection(
  root: string,
  sessionId: string,
  section: Section,
  doc: SessionDoc,
  req: RunRequest,
  engine: AgentEngine,
  emit: (m: AskMessage) => void,
  opts: { markStale: boolean }
): Promise<void> {
  const sectionId = section.id
  const send = (message: SectionMessage): void => emit({ type: 'section', sectionId, message })
  await setSectionStatus(root, sessionId, sectionId, 'generating')
  send({ type: 'status', status: 'generating' })

  let body = ''
  let errored = false
  let settled = false
  try {
    for await (const ev of engine.run(req)) {
      send({ type: 'event', event: ev })
      await appendTranscript(root, sessionId, ev, { sectionId })
      if (ev.kind === 'text_delta') {
        body += ev.text
      } else if (ev.kind === 'turn_end') {
        if (!errored) {
          await writeDocument(root, sessionId, updateSectionBody(doc, sectionId, body))
          await setSectionStatus(root, sessionId, sectionId, 'ready')
          send({ type: 'status', status: 'ready' })
          if (opts.markStale) {
            const staled = await markDependentsStale(root, sessionId, sectionId)
            if (staled.length) emit({ type: 'stale', sectionIds: staled })
          }
        }
        settled = true
      } else if (ev.kind === 'error') {
        errored = true
        await setSectionStatus(root, sessionId, sectionId, 'error')
        send({ type: 'status', status: 'error' })
        settled = true
      }
    }
  } catch (err) {
    await setSectionStatus(root, sessionId, sectionId, 'error')
    send({ type: 'status', status: 'error' })
    throw err
  }
  if (!settled) {
    await setSectionStatus(root, sessionId, sectionId, 'error')
    send({ type: 'status', status: 'error' })
  }
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
