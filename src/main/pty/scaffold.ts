import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// The relative path (inside the session cwd) Claude is asked to write.
export const ARTIFACT_FILE = 'result.html'

// Shell command registered as the Claude Code `Stop` hook (and PostToolUse).
// Reads the hook JSON from stdin and POSTs it to our loopback server. Port and
// token arrive via the pty env (set by ptyHost). `|| true` keeps a broken hook
// from ever surfacing a non-zero exit to the agent (fail open).
export const HOOK_COMMAND =
  'curl -s -X POST ' +
  '-H "X-Workphlo-Hook-Token: $WORKPHLO_HOOK_TOKEN" ' +
  '--data-binary @- ' +
  '--connect-timeout 0.5 --max-time 1.5 --noproxy 127.0.0.1 ' +
  'http://127.0.0.1:$WORKPHLO_HOOK_PORT/hook || true'

// Text appended to Claude's system prompt on every CLI-mode launch.
export function steeringSystemPrompt(): string {
  return (
    'When you have a result to present to the user, use the ' +
    '`workphlo-html-report` skill: write (or overwrite) a complete, ' +
    'self-contained, styled HTML document to `result.html` in the current ' +
    'working directory. Keep it updated as your result evolves.'
  )
}

const SKILL_MD = `---
name: workphlo-html-report
description: Use whenever you have a result, answer, summary, or deliverable to present. Write it as a complete styled HTML document to result.html in the working directory.
---

# Workphlo HTML Report

When you have something to show the user, do NOT rely on terminal text alone.
Write a **complete, self-contained HTML document** to \`result.html\` in the
current working directory, overwriting any previous version.

Requirements:
- A single valid HTML fragment: a top-level \`<article class="wf-report">\`.
- Inline \`<style>\` only (no external assets, no network requests, no scripts).
- Structure: an \`<h1>\` title, an optional \`<p class="wf-summary">\` lead, then
  the body as semantic sections.
- Update the same file as your result evolves; it is rendered live beside the
  terminal.
`

// Scaffold the CLI session working dir: the html-report skill + a project-scoped
// settings.json registering the Stop / PostToolUse(Write) hooks. Idempotent.
export async function scaffoldCliSession(cwd: string): Promise<void> {
  const skillDir = join(cwd, '.claude', 'skills', 'workphlo-html-report')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), SKILL_MD)

  const settings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }],
      PostToolUse: [
        { matcher: 'Write', hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }
      ]
    }
  }
  await writeFile(join(cwd, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
}
