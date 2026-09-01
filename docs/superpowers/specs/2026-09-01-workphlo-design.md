# workphlo — Design Spec

Date: 2026-09-01
Status: Draft (iterating)

## 1. Context & Motivation

Working with Claude Code today is a linear, ephemeral TUI conversation. When
the real deliverable is a *document that must be iterated* — a spec, a design,
a review — the linear chat is a poor fit: you cannot address one part of the
output, expand only it, or have different specialists own different parts.

**workphlo** is a local, Electron-based, Obsidian/VSCode-like workbench for
driving Claude Code. Instead of a scrolling transcript, each session produces a
**live document** made of typed **sections** ("cells"). Each section is owned
by a specialist agent — one of the *many hats a developer wears* (architect,
reviewer, perf analyst, security, summarizer…) — and can be independently
generated, inspected, questioned, intervened in, expanded, and refreshed. A
bottom prompt bar keeps the familiar Claude Code TUI feel for free-form
continuation.

The tool is meta by design: this very spec is the kind of document workphlo is
meant to help iterate — grow one section without disturbing the rest.

### Goals

- Manage multiple **projects** and **agent sessions** in a nestable tree.
- Turn each session into a **live, notebook-style document** of typed sections.
- Let a section be **selected, questioned, intervened in, expanded, and
  refreshed** in place, with dependent sections re-integrated on demand.
- Route each section to a **specialist "hat"** with its own engine + model.
- Run agents via **both** the Claude Agent SDK (per-section model choice, incl.
  lighter/local/Bedrock models) **and** the `claude` CLI (the path available in
  AWS environments), behind one abstraction.
- Store everything as **plain local files** (git optional), diffable and
  human-inspectable.

### Non-goals (initial)

- Not a general IDE; it drives agents, it is not a full code editor.
- No cloud sync / multi-user collaboration in early phases.
- No bespoke model hosting; "local/lighter model" means pointing an existing
  engine (SDK/Bedrock/local endpoint) at a smaller model.

## 2. Architecture

Electron app, three layers with a hard boundary between UI and execution.

- **Main process (Node):** owns the workspace filesystem, the **agent engine**,
  session lifecycle, process/credential handling, and IPC. All Claude execution
  and all disk access live here.
- **Renderer (React + TypeScript + Vite):** the UI — left tree pane, center
  section canvas, bottom prompt bar. Tailwind + shadcn/ui for the shell;
  CodeMirror / Monaco for editors and diffs.
- **Preload:** a typed `contextBridge` IPC surface. The renderer never touches
  the filesystem or spawns processes directly.

### 2.1 Engine abstraction (the key seam)

A single `AgentEngine` interface with two first-class adapters (both present
from P0 — not sequential):

- **`SdkEngine`** — wraps `@anthropic-ai/claude-agent-sdk` (`query()`), or the
  Messages API where finer control is needed. Enables **per-section model
  choice** (e.g. a light/local/Bedrock model for summaries), session resume,
  fork, subagents, and skills.
- **`CliEngine`** — spawns `claude` in stream-json mode
  (`--output-format stream-json --input-format stream-json`) and parses NDJSON.
  The path that works where **AWS/Bedrock via the CLI** is the main access
  available. Reuses the user's existing CC config, skills, and MCP.

Both **normalize** to one event stream so nothing upstream cares which ran:

```
type EngineEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; result: unknown; isError: boolean }
  | { kind: 'needs_input'; prompt: string; kind_hint?: 'question' | 'permission' }
  | { kind: 'turn_end'; sessionId: string; usage?: TokenUsage }
  | { kind: 'error'; message: string }
```

Engines expose: `run(request): AsyncIterable<EngineEvent>`, `resume(sessionId)`,
`fork(sessionId)`, and `interrupt()`. A `RunRequest` carries the resolved
`{engine, model, systemPrompt, allowedTools, skills, contextBundle}`.

### 2.2 Model routing

Model/engine is a property of the **hat (role)**, overridable **per section**.
Resolution order: section override → hat default → workspace default. This is
how "summaries use a lighter model while review uses a strong one" is expressed
without the canvas knowing anything about models.

## 3. Data model & storage

A **workspace** is a root folder of plain files (git optional).

```
workspace/
  workphlo.json                 # workspace settings, engine + default model config
  templates/                    # user-editable session templates (built-ins seeded here)
  hats/                         # user-editable agent roles ("hats") + their skills
  projects/<slug>/
    project.json                # meta + ordered child node ids (nesting)
    sessions/<slug>/
      session.json              # template id, hat bindings, per-section overrides, status
      document.md               # the live document — SOURCE OF TRUTH
      transcript.jsonl          # full normalized event log per turn (resume/audit)
      artifacts/                # generated files, captured diffs, attachments
```

- **Tree nesting** = folder hierarchy. A node is `project | session`; projects
  nest arbitrarily. `project.json` holds child order.
- **git optional:** the app runs without git; when a workspace *is* a git repo,
  refresh/edit can optionally commit (later phase).

### 3.1 Document model — live, notebook-style

`document.md` is the single source of truth: diffable, Obsidian-native,
human-editable. Sections are delimited by HTML comments carrying **stable IDs**
so selections, threads, and stale-tracking survive edits:

```
<!-- wf:section id=sum type=summary hat=summarizer format=html -->
<h2>Summary</h2>
<p>…agent-authored body…</p>
<!-- wf:/section -->
```

- The app owns the **scaffold** (which sections, order, titles) seeded from the
  template; the **body** is agent-authored.
- The document is **live**: asking a section can edit it in place, or **split /
  append** new cells — sections beyond the template are first-class.
- Volatile metadata (status, timestamps, token usage, thread refs) lives in
  `session.json`, keyed by section id — kept out of the markdown so the doc
  stays clean and diffable.

### 3.2 Section types & renderer registry (VSCode-like)

Each section's `type` selects a **renderer (+ editor)** from a registry, so a
section looks right for what it holds — not one generic blob:

| type          | renderer                              | body / data                        |
|---------------|---------------------------------------|------------------------------------|
| `summary`     | rich HTML doc view                    | HTML (default) or markdown         |
| `requirements`| rich HTML/markdown doc view           | HTML/md                            |
| `diff`        | Monaco/CodeMirror **merge view**      | unified diff or before/after refs  |
| `code`        | syntax-highlighted editor             | file body + language               |
| `review`      | annotated **findings list**           | structured findings[]              |
| `perf`        | tables / charts (dataviz)             | structured metrics                 |
| `open-qs`     | checklist / Q&A list                  | structured questions[]             |

- **Body format:** HTML preferred (richer; rendered in a **sandboxed iframe**
  per cell), markdown accepted (`format: html | md`). Structured types
  (`diff`, `review`, `perf`) carry typed data the renderer understands.
- The registry is **extensible** — new `type → component` pairs can be added
  without touching the doc engine.

## 4. Templates & context recipes

A **SessionTemplate** is a **soft guide** for visualizing a session, not a rigid
container. Per section it declares:

- **hat** — which role owns/generates it,
- a **context recipe** — what to feed that section and how: other sections by
  id, the working diff, linked artifacts, repo paths, prior turn output,
- **default engine/model** (inherited from the hat, overridable).

```jsonc
// templates/spec-design.json
{
  "id": "spec-design",
  "name": "Spec / Design",
  "sections": [
    { "type": "summary",      "title": "Summary",       "hat": "summarizer",
      "context": ["session.goal", "section:requirements", "section:design"] },
    { "type": "requirements", "title": "Requirements",  "hat": "analyst",
      "context": ["session.goal"] },
    { "type": "code",         "title": "Design",        "hat": "architect",
      "context": ["section:requirements", "repo.paths"] },
    { "type": "open-qs",      "title": "Open Questions", "hat": "architect",
      "context": ["section:design"] }
  ],
  "dependencies": { "summary": ["requirements", "design"], "open-qs": ["design"] }
}
```

Built-ins seeded on first run (each user-editable via clone): **Spec/Design**,
**Code Change** (Summary, Diff, Code Review, Perf Review, Tests). Templates live
in `workspace/templates/`.

## 5. Hats (agent roles)

A **hat** models one of the many hats a developer wears. App-defined, shipped
with predefined skills, user-editable in `workspace/hats/`.

```jsonc
// hats/reviewer.json
{
  "id": "reviewer",
  "name": "Code Reviewer",
  "systemPrompt": "…",
  "engine": "cli",              // or "sdk"
  "model": "…",                 // default; section may override
  "allowedTools": ["Read", "Grep", "Bash(read-only)"],
  "skills": ["code-review"]
}
```

Seeded hats: `summarizer` (SDK + light model), `analyst`, `architect`,
`reviewer`, `perf-analyst`, `security`, `differ`. Actions
(summary / diff / review / perf / ask-about-highlight) route to the bound hat,
passing the section's resolved context bundle.

## 6. Interactions

- **Bottom prompt bar** — free text, Claude Code TUI feel; streams into the
  active section's thread and/or the session transcript. Slash-commands trigger
  actions (`/summary`, `/diff`, `/review`, `/fork`, `/refresh`).
- **Highlight-to-ask (live intervene)** — select a region inside a rendered
  section → floating menu with **pre-canned follow-ups** (*add detail*,
  *I disagree — change this*, *explain why*, *expand*) **+ free text**. The
  selection is anchored by `{sectionId, DOM range / text offset}` so the ask is
  scoped to exactly what was picked. Result either edits in place or opens a
  **thread** on that section; expansion may append/split cells.
- **Reintegrate + Refresh** — editing or answering a section marks its
  dependents (per the template `dependencies` map) **stale**. A per-section or
  whole-doc **Refresh** re-runs the owning hats with the updated context bundle.
  Explicit and user-triggered — never silent.
- **"Needs-you" surfacing** — when a turn ends on `needs_input` (an open
  question or a permission prompt), the section shows a clear **Needs you**
  state with the pending question, and the tree node **badges** it so blocked
  work is obvious at a glance.
- **Fork** — duplicates the document and **resumes the engine session** (SDK)
  from the same point under a new `sessionId`; appears as a sibling/child in the
  tree. Lets you explore a branch without losing the original.
- **Execute commands** — tool use (incl. shell) runs in Main with a
  **permission prompt** surfaced in the UI before any non-read action.

## 7. Left pane (tree)

Nestable tree of `project` and `session` nodes (projects nest arbitrarily).
Nodes show status badges (generating / stale / needs-you). Sessions expose their
artifacts. Create / rename / move / delete via the tree; ordering persisted in
`project.json`.

## 8. Cross-cutting concerns

- **Security / sandboxing:** agent-authored HTML renders in a **sandboxed
  iframe** (no Node integration, CSP-restricted, no arbitrary network). Renderer
  runs with `contextIsolation` on and `nodeIntegration` off. Tool/command
  execution is gated by explicit permission prompts.
- **Credentials:** engines read the environment's existing Claude/AWS
  credentials; workphlo does not store secrets. CLI path inherits the user's
  configured `claude` auth; SDK path uses configured API/Bedrock credentials.
- **Persistence & crash-safety:** the normalized event stream is appended to
  `transcript.jsonl` per turn; `document.md` is written atomically on section
  completion so a crash never corrupts the doc.
- **Concurrency:** multiple sessions run concurrently; each section run is a
  cancellable task (`interrupt()`), surfaced per-cell.

## 9. Tech stack

- Electron, React 18 + TypeScript, Vite.
- Tailwind CSS + shadcn/ui (shell); CodeMirror 6 or Monaco (editors, diff merge
  view); a charting lib for `perf` (per the dataviz guidance).
- `@anthropic-ai/claude-agent-sdk` (SDK engine); child-process + NDJSON parser
  (CLI engine).
- State: a lightweight store (Zustand/Redux-Toolkit) in the renderer; Main is
  the source of truth over IPC.

## 10. Phasing (thin v1 called out)

- **P0 — Foundations:** Electron + React + Vite scaffold; file/workspace model;
  typed IPC; left tree pane (create/read projects & sessions); transcript view;
  **engine abstraction with both `CliEngine` + `SdkEngine`** behind it.
- **P1 — thin v1 (vertical slice):** one built-in template with context recipes
  → hats generate live typed cells → `summary`/`code`/`diff` renderers →
  streaming bottom prompt bar → per-section status → **per-section model
  override** (core value; included here).
- **P2 — Live-doc interactions:** highlight-to-ask threads, in-place
  intervene/expand, cell split/append, stale + Refresh reintegration.
- **P3 — Hats & dispatch:** full app-defined roles + predefined skills,
  action→hat routing (summary/diff/review/perf/security), needs-you/blocked
  surfacing, permission prompts.
- **P4 — Tree power & sessions:** arbitrary nesting, artifacts, **fork** (SDK
  resume), template & hat editors, optional git commits.

## 11. Open questions

- Selection anchoring across HTML re-renders: DOM-range vs text-offset vs
  injected span markers — which survives agent rewrites best?
- Exact `RunRequest.contextBundle` shape and size limits (token budgeting per
  section).
- Whether `transcript.jsonl` is per-session or per-section-thread.
- Diff source for the `diff` type: git working tree vs agent-produced patch vs
  before/after file snapshots.
- Minimum CLI version / flags required for stable stream-json round-tripping.
