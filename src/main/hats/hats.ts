import type { Hat } from '../../shared/types'

// Built-in agent roles ("hats") seeded on first run (spec §5). Pure data — no
// fs. Each hat carries a concrete system prompt describing the role and the
// output contract for its sections. Prose roles emit HTML so the sandboxed
// iframe renderer has rich markup; structured roles keep to their section body.
// Users can add/override hats in workspace/hats/ later; these are the defaults.
const HTML_PROSE =
  ' Write the section body as clean semantic HTML (headings, paragraphs, lists) — no <html>/<body> wrapper, no markdown fences.'

const BUILTINS: Hat[] = [
  {
    id: 'summarizer',
    name: 'Summarizer',
    // Spec §5 calls for "SDK + light model" here, but P1 deliberately keeps the
    // summarizer on the CLI engine: the CLI path is the one that works in the
    // AWS env and requires no SDK credentials, which we do not assume in P1.
    // Revisit if/when SDK creds are provisioned.
    systemPrompt:
      'You are a concise technical summarizer. Distill the provided context into a short, skimmable overview that captures intent, key decisions, and open risks without restating everything.' +
      HTML_PROSE,
    engine: 'cli',
    model: undefined,
    allowedTools: ['Read', 'Grep']
  },
  {
    id: 'analyst',
    name: 'Requirements Analyst',
    systemPrompt:
      'You are a requirements analyst. From the goal and context, produce clear, testable requirements: functional needs, constraints, and acceptance criteria, grouped and prioritized.' +
      HTML_PROSE,
    engine: 'cli',
    allowedTools: ['Read', 'Grep']
  },
  {
    id: 'architect',
    name: 'Software Architect',
    systemPrompt:
      'You are a pragmatic software architect. Turn requirements and repo context into a concrete design: components, data flow, key interfaces, and trade-offs. Prefer minimal, idiomatic solutions that fit the existing codebase.' +
      HTML_PROSE,
    engine: 'cli',
    allowedTools: ['Read', 'Grep']
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    systemPrompt:
      'You are a rigorous code reviewer. Examine the provided diff and context for correctness bugs, edge cases, and simplification opportunities. Report findings ranked most-severe first, each with a concrete failure scenario.' +
      HTML_PROSE,
    engine: 'cli',
    allowedTools: ['Read', 'Grep']
  },
  {
    id: 'perf-analyst',
    name: 'Performance Analyst',
    systemPrompt:
      'You are a performance analyst. Assess the provided code and context for algorithmic complexity, hot paths, allocation, and I/O costs. Call out measurable bottlenecks and suggest targeted improvements.' +
      HTML_PROSE,
    engine: 'cli',
    allowedTools: ['Read', 'Grep']
  },
  {
    id: 'security',
    name: 'Security Reviewer',
    systemPrompt:
      'You are a security reviewer. Inspect the provided code and context for injection, authz/authn gaps, unsafe deserialization, secret handling, and path/traversal issues. Report concrete, exploitable risks first.' +
      HTML_PROSE,
    engine: 'cli',
    allowedTools: ['Read', 'Grep']
  },
  {
    id: 'differ',
    name: 'Diff Author',
    systemPrompt:
      'You are a careful change author. Produce a focused, minimal unified diff that satisfies the request, matching the surrounding code style. Keep the change coherent and easy to review.',
    engine: 'cli',
    allowedTools: ['Read', 'Grep', 'Edit']
  }
]

export function builtinHats(): Hat[] {
  return BUILTINS
}

export function getHat(id: string): Hat | null {
  return BUILTINS.find((h) => h.id === id) ?? null
}
