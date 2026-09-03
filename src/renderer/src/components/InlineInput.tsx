import { useState, type JSX, type RefObject } from 'react'

// Inline single-line text entry used in place of window.prompt, which Electron
// does not support (it throws "prompt() is not supported.").
//
// Interaction contract (see the electron-renderer-safety guidance):
//   - Enter or the ✓ button submits a non-empty, trimmed value.
//   - Escape or the ✕ button cancels.
//   - Blur cancels ONLY when the field is empty, so clicking elsewhere never
//     silently discards text the user has typed.
//   - The ✓/✕ buttons preventDefault on mousedown so a click commits/cancels
//     instead of first blurring the input (which would race the click).
//   - On close (submit or cancel) focus returns to the trigger button when a
//     restoreFocusRef is provided, so keyboard users are not stranded.
export function InlineInput({
  placeholder,
  ariaLabel,
  onSubmit,
  onCancel,
  restoreFocusRef
}: {
  placeholder: string
  ariaLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
  restoreFocusRef?: RefObject<HTMLButtonElement | null>
}): JSX.Element {
  const [value, setValue] = useState('')
  const restoreFocus = (): void => restoreFocusRef?.current?.focus()
  // `restore` moves focus back to the trigger button on close. It MUST stay off
  // for the Enter-key path: restoring focus to the trigger mid-keystroke lets the
  // same Enter's keyup activate that now-focused button, re-opening this input.
  // So only the explicit dismiss controls (Escape / ✕) and the ✓ click restore.
  const submit = (restore: boolean): void => {
    const name = value.trim()
    if (!name) return
    onSubmit(name)
    if (restore) restoreFocus()
  }
  const cancel = (restore: boolean): void => {
    onCancel()
    if (restore) restoreFocus()
  }
  return (
    <span className="mt-1 flex w-full items-center gap-1">
      <input
        autoFocus
        aria-label={ariaLabel ?? placeholder}
        className="flex-1 rounded border px-1 py-0.5 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter: submit WITHOUT restoring focus (see submit()'s note).
          if (e.key === 'Enter') submit(false)
          else if (e.key === 'Escape') cancel(true)
        }}
        // Cancel on blur ONLY when empty: an empty field left behind is just
        // tidied away, but typed text is preserved until the user explicitly
        // submits (Enter/✓) or cancels (Escape/✕). Blur means focus is already
        // moving elsewhere, so don't yank it back to the trigger.
        onBlur={() => {
          if (value.trim() === '') cancel(false)
        }}
      />
      <button
        type="button"
        aria-label="Confirm"
        title="Confirm"
        className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => submit(true)}
      >
        ✓
      </button>
      <button
        type="button"
        aria-label="Cancel"
        title="Cancel"
        className="rounded border px-1.5 py-0.5 text-xs text-slate-600"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => cancel(true)}
      >
        ✕
      </button>
    </span>
  )
}
