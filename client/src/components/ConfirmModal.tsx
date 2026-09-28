import { useState } from 'react';
import { Overlay } from './Overlay';

// Themed confirmation dialog — replaces the browser's window.confirm popup.
// Render it conditionally from a parent that holds the "what am I confirming" state.
//
// Pass `note` to ask for a line of explanation before the action goes ahead —
// used where the office has to say why it is asking the super admin for
// something. The text comes back through onConfirm, and the button is never
// dead: pressing it with the box empty says what is wanted.
export function ConfirmModal({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  note,
  onConfirm,
  onClose,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** Ask for a reason before confirming. */
  note?: {
    label: string;
    placeholder?: string;
    help?: string;
    /** Minimum length before the action is allowed. Default 5. */
    min?: number;
  };
  onConfirm: (note?: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const min = note?.min ?? 5;

  const go = () => {
    if (note && text.trim().length < min) {
      setError(`${note.label} — please write a line or two.`);
      return;
    }
    setError('');
    onConfirm(note ? text.trim() : undefined);
  };

  return (
    <Overlay align="center" z="z-[70]" onClose={onClose}>
      <div className="card w-full max-w-sm p-6 max-h-[85vh] overflow-y-auto thin-scroll" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">{title}</h2>
        <p className="muted text-sm mb-5">{message}</p>

        {note && (
          <div className="mb-5">
            <label className="text-xs font-medium muted block">
              {note.label} <span className="text-red-500">*</span>
            </label>
            <textarea
              className="input mt-1 min-h-[64px]"
              placeholder={note.placeholder}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
            {note.help && <p className="muted text-xs mt-1">{note.help}</p>}
          </div>
        )}

        {error && <div className="text-sm text-red-500 mb-3">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button
            className={danger
              ? '!py-2 !px-4 rounded-lg border border-red-500/40 text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50 font-medium'
              : 'btn-primary'}
            onClick={go}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
