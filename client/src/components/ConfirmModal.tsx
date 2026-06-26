// Themed confirmation dialog — replaces the browser's window.confirm popup.
// Render it conditionally from a parent that holds the "what am I confirming" state.
export function ConfirmModal({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">{title}</h2>
        <p className="muted text-sm mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button
            className={danger
              ? '!py-2 !px-4 rounded-lg border border-red-500/40 text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50 font-medium'
              : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
