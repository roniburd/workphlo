import { useMemo, type JSX, type RefObject } from 'react'
import type { Section, SectionType } from '../../../shared/types'

// Per-render crypto-random nonce. Only our trusted reporter <script> carries it,
// so under the nonce CSP agent-authored inline/remote scripts (which cannot know
// or guess it) never execute. MUST be unguessable and fresh per body.
function makeNonce(): string {
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Per-render CSP: default-src 'none' blocks ALL network/beacon/fetch/remote-img
// (no egress, §8 intact); script-src is pinned to our nonce so only the trusted
// reporter runs — agent scripts have no matching nonce and no eval. style-src
// 'unsafe-inline' + img-src data: keep the markup rich without any network.
function cspMeta(nonce: string): string {
  return (
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
    `script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:">`
  )
}

// The trusted, app-authored reporter injected into the sandbox alongside the CSP
// meta. It (1) on mouseup reports the current selection to the parent as a
// quote-based anchor {quote, prefix, suffix, startHint, bodyHash, rect} in the
// iframe's OWN rendered-text coordinate space, and (2) answers an inbound
// wf:anchors message by reporting whether each stored quote still resolves. It
// only ever postMessages the parent — never the network (blocked anyway) — and
// inbound messages carry only quote strings that are LOCATED, never executed.
function reporterScript(sectionId: string): string {
  const sid = JSON.stringify(sectionId)
  return `
(function(){
  function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)}
  function report(){
    var sel=window.getSelection();
    if(!sel||sel.isCollapsed||sel.rangeCount===0){parent.postMessage({type:'wf:selectionCleared',sectionId:${sid}},'*');return}
    var q=sel.toString();
    if(!q){return}
    var full=document.body.textContent||'';
    var start=-1;
    try{var range=sel.getRangeAt(0);var pre=range.cloneRange();pre.selectNodeContents(document.body);pre.setEnd(range.startContainer,range.startOffset);start=pre.toString().length}catch(e){start=-1}
    if(start<0||full.slice(start,start+q.length)!==q){start=full.indexOf(q)}
    if(start<0){return}
    var r={top:0,left:0,bottom:0,right:0,width:0,height:0};
    try{var b=sel.getRangeAt(0).getBoundingClientRect();r={top:b.top,left:b.left,bottom:b.bottom,right:b.right,width:b.width,height:b.height}}catch(e2){}
    parent.postMessage({type:'wf:selection',sectionId:${sid},quote:q,prefix:full.slice(Math.max(0,start-32),start),suffix:full.slice(start+q.length,start+q.length+32),startHint:start,bodyHash:hash(full),rect:r},'*')
  }
  document.addEventListener('mouseup',report);
  window.addEventListener('message',function(e){
    var d=e.data;if(!d||d.type!=='wf:anchors'||!Array.isArray(d.anchors)){return}
    var full=document.body.textContent||'';
    var states=d.anchors.map(function(a){return {anchorId:a.anchorId,state:(a.quote&&full.indexOf(a.quote)>=0)?'anchored':'orphaned'}});
    parent.postMessage({type:'wf:anchorStates',sectionId:${sid},states:states},'*')
  });
})();`
}

// Agent-authored HTML is rendered inside a locked-down sandboxed iframe (spec
// §8). sandbox="allow-scripts" (NEVER allow-same-origin → opaque origin: no
// parent DOM, no storage, no preload bridge) lets ONLY our nonce'd reporter run
// under the per-render nonce CSP. The parent listens for the reporter's
// postMessages (validating e.source === this iframe) to drive the ask menu.
function HtmlBody({
  body,
  sectionId,
  frameRef
}: {
  body: string
  sectionId: string
  frameRef?: RefObject<HTMLIFrameElement | null>
}): JSX.Element {
  // Fresh nonce per body change (unguessable, single-use). `body` is the
  // intended trigger even though it isn't read inside — a new body ⇒ new nonce,
  // and a stable nonce across re-renders of the same body avoids iframe reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nonce = useMemo(() => makeNonce(), [body])
  const srcDoc = `${cspMeta(nonce)}${body}<script nonce="${nonce}">${reporterScript(sectionId)}</script>`
  return (
    <iframe
      ref={frameRef}
      title="section-html"
      // allow-scripts ONLY — withholding allow-same-origin keeps the frame opaque
      // (no bridge/storage), so a script gaining execution still cannot reach the
      // privileged renderer.
      sandbox="allow-scripts"
      className="w-full min-h-24 border-0 bg-white"
      srcDoc={srcDoc}
    />
  )
}

function TextBody({ body }: { body: string }): JSX.Element {
  return <pre className="whitespace-pre-wrap text-sm">{body}</pre>
}

function CodeBody({ body }: { body: string }): JSX.Element {
  return (
    <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
      <code>{body}</code>
    </pre>
  )
}

function DiffBody({ body }: { body: string }): JSX.Element {
  const lines = body.split('\n')
  return (
    <div className="overflow-auto rounded border font-mono text-xs">
      {lines.map((line, i) => {
        const meta = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
        const kind = meta
          ? 'meta'
          : line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'del'
              : 'ctx'
        const cls =
          kind === 'add'
            ? 'bg-green-100 text-green-900'
            : kind === 'del'
              ? 'bg-red-100 text-red-900'
              : kind === 'meta'
                ? 'bg-slate-100 text-slate-500'
                : 'text-slate-700'
        return (
          <div key={i} data-diff={kind} className={`whitespace-pre px-2 ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

// The extensible type → renderer registry (spec §3.2). New section types add a
// row here without touching the canvas. HTML bodies receive the iframe ref (so
// the cell can validate the reporter's postMessages); non-HTML bodies render in
// the main DOM and are selected natively by the cell.
type Ref = RefObject<HTMLIFrameElement | null> | undefined
function htmlOrText(s: Section, frameRef: Ref): JSX.Element {
  return s.format === 'html' ? (
    <HtmlBody body={s.body} sectionId={s.id} frameRef={frameRef} />
  ) : (
    <TextBody body={s.body} />
  )
}
const REGISTRY: Partial<Record<SectionType, (s: Section, frameRef: Ref) => JSX.Element>> = {
  summary: (s, r) => htmlOrText(s, r),
  requirements: (s, r) => htmlOrText(s, r),
  code: (s) => <CodeBody body={s.body} />,
  diff: (s) => <DiffBody body={s.body} />
}

export function SectionBody({
  section,
  frameRef
}: {
  section: Section
  frameRef?: RefObject<HTMLIFrameElement | null>
}): JSX.Element {
  const render = REGISTRY[section.type]
  if (render) return render(section, frameRef)
  // Fallback: honour the declared format, default to plain text.
  return htmlOrText(section, frameRef)
}
