import type { SelectionAnchor } from '../../../shared/types'

// Amount of surrounding rendered text kept on each side of the quote to
// disambiguate duplicate quotes when the exact-hash fast path misses.
const CONTEXT = 32

// FNV-1a over the rendered plain text. Cheap, dependency-free, and stable across
// the main-DOM (md/code) and iframe (html) reporters so BOTH express anchors in
// one coordinate space (rendered textContent), per the P2 anchoring design.
export function hashText(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

// Build a quote-based anchor from a selection over `fullText` (the RENDERED
// plain text of a section). `start`/`end` are char offsets into that text.
export function buildAnchor(
  sectionId: string,
  fullText: string,
  start: number,
  end: number
): SelectionAnchor {
  return {
    sectionId,
    quote: fullText.slice(start, end),
    prefix: fullText.slice(Math.max(0, start - CONTEXT), start),
    suffix: fullText.slice(end, end + CONTEXT),
    startHint: start,
    bodyHash: hashText(fullText),
    state: 'anchored'
  }
}

// All start offsets of `quote` in `text`.
function allOccurrences(text: string, quote: string): number[] {
  if (!quote) return []
  const out: number[] = []
  let from = 0
  for (;;) {
    const i = text.indexOf(quote, from)
    if (i < 0) break
    out.push(i)
    from = i + 1
  }
  return out
}

// Re-resolve a stored anchor against the CURRENT rendered text. Mirrors the P2
// resolution algorithm:
//   1. hash match  → trust startHint directly (unchanged body; UI remount).
//   2. unique quote → use it.
//   3. duplicate quotes → score each by prefix/suffix overlap, break ties by
//      nearest startHint.
//   4. no match → orphaned (thread stays section-scoped; never mis-points).
export function resolveAnchor(
  anchor: SelectionAnchor,
  fullText: string
): { start: number; end: number; state: 'anchored' | 'orphaned' } {
  const { quote } = anchor
  const len = quote.length
  // (1) exact fast path: same rendered text as capture time.
  if (hashText(fullText) === anchor.bodyHash) {
    if (fullText.slice(anchor.startHint, anchor.startHint + len) === quote) {
      return { start: anchor.startHint, end: anchor.startHint + len, state: 'anchored' }
    }
  }
  const hits = allOccurrences(fullText, quote)
  if (hits.length === 0) return { start: -1, end: -1, state: 'orphaned' }
  // (2) unique.
  if (hits.length === 1) return { start: hits[0], end: hits[0] + len, state: 'anchored' }
  // (3) disambiguate with prefix/suffix, then nearest-to-startHint.
  let best = hits[0]
  let bestScore = -1
  for (const h of hits) {
    const pre = fullText.slice(Math.max(0, h - CONTEXT), h)
    const suf = fullText.slice(h + len, h + len + CONTEXT)
    const score = commonSuffixLen(pre, anchor.prefix) + commonPrefixLen(suf, anchor.suffix)
    const better =
      score > bestScore ||
      (score === bestScore && Math.abs(h - anchor.startHint) < Math.abs(best - anchor.startHint))
    if (better) {
      best = h
      bestScore = score
    }
  }
  return { start: best, end: best + len, state: 'anchored' }
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}
function commonSuffixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

// Compute {start,end,quote} of the current DOM Selection within `el`, expressed
// as offsets into el.textContent. Uses a Range walk for precision and falls back
// to indexOf when Range math is unavailable (older engines / jsdom quirks).
export function selectionOffsets(
  el: HTMLElement,
  sel: Selection
): { start: number; end: number; quote: string } | null {
  const quote = sel.toString()
  if (!quote) return null
  const full = el.textContent ?? ''
  let start = -1
  try {
    const range = sel.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(el)
    pre.setEnd(range.startContainer, range.startOffset)
    start = pre.toString().length
  } catch {
    start = -1
  }
  if (start < 0 || full.slice(start, start + quote.length) !== quote) {
    start = full.indexOf(quote)
  }
  if (start < 0) return null
  return { start, end: start + quote.length, quote }
}
