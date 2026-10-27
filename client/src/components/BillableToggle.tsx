import { Gift, Wallet } from 'lucide-react';

/**
 * Billable, or not billable.
 *
 * Two named buttons rather than a switch, because "Billable" switched off does
 * not say what it then is — and this decides whether a family is charged for a
 * class, which is not a thing to leave to an unlabelled grey toggle.
 *
 * Both words are said in full. "Free" was tried and dropped: on a statement it
 * reads as a discount the family was given, when what is meant is only that
 * this class is not billed.
 *
 * Billable is the ordinary case, so it is the quiet one. Not billable is the
 * exception and reads as the exception, in the same amber the rest of the app
 * uses for "look at this".
 */
export function BillableToggle({
  value,
  onChange,
  disabled = false,
  compact = false,
  className = '',
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** For a crowded line: no icons, tighter padding. The words stay. */
  compact?: boolean;
  className?: string;
}) {
  const btn = (on: boolean, accent: 'plain' | 'amber') =>
    `inline-flex items-center gap-1 rounded-md ${compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'} font-semibold transition-colors disabled:opacity-50 ${
      on
        ? accent === 'amber'
          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
          : 'bg-[var(--color-card)] text-[var(--color-primary)] shadow-sm'
        : 'muted hover:text-[var(--color-text)]'
    }`;

  return (
    <div
      role="group"
      aria-label="Charge the student for this class"
      className={`inline-flex gap-0.5 p-0.5 rounded-lg pill shrink-0 ${className}`}
    >
      <button type="button" disabled={disabled} aria-pressed={value} className={btn(value, 'plain')}
        title="The hours come off the student's balance" onClick={() => onChange(true)}>
        {!compact && <Wallet size={12} />} Billable
      </button>
      <button type="button" disabled={disabled} aria-pressed={!value} className={btn(!value, 'amber')}
        title="Taught and recorded, but no hours are charged" onClick={() => onChange(false)}>
        {!compact && <Gift size={12} />} Not billable
      </button>
    </div>
  );
}

/** True when this class was taught but is not being charged. */
export const notBillable = (v?: number | boolean | null) => v === 0 || v === false;

/**
 * The tint a not-billable entry carries wherever entries are listed — the same
 * pale amber on every screen, so one is recognised at a glance without having
 * to read the line. Billable entries are left alone: they are the normal case,
 * and tinting every row would hide the one that matters.
 */
export const NOT_BILLABLE_ROW = 'bg-amber-400/10';

/**
 * The same fact where there is nothing to press — a statement, a history, a
 * list. Nothing at all is shown for a charged class.
 */
export function NotBillableChip({ is_billable }: { is_billable?: number | boolean | null }) {
  if (!notBillable(is_billable)) return null;
  // Filled, like every other status pill: a 20% wash disappeared against a
  // hovered row, which is exactly where somebody is looking when they check
  // whether a class was charged.
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2.5 py-0.5 text-xs font-semibold text-amber-950 whitespace-nowrap"
      title="Taught and recorded, but not charged to the student">
      <Gift size={11} /> Not billable
    </span>
  );
}
