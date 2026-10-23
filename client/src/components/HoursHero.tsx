import { AlertTriangle } from 'lucide-react';
import { hrs } from '../api/client';
import { StatusBadge } from './ui';

/**
 * The top of the student and parent home screens: who the student is, and the
 * one number both of them open the app for — hours left. The ring shows how
 * much of what was bought has been used.
 */
export function HoursHero({ student: s, ledger: L }: { student: any; ledger: any }) {
  const left = Number(L?.hours_left) || 0;
  // One wrapper, so the parent's space-y spacing sees a single child whichever
  // half is showing. Laptop and up keep the original header and chips as they were.
  return (
    <div>
      <div className="lg:hidden"><Hero student={s} ledger={L} /></div>
      <div className="hidden lg:block space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{s.full_name}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="muted text-sm mt-0.5">
            {s.year_grade} · {s.exam_board}{s.form_no ? ` · Form ${s.form_no}` : ''}
          </p>
        </div>

        {/* Minimal hours summary */}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
            <span className="font-bold" style={{ color: left <= 5 ? 'var(--color-accent)' : 'var(--color-primary)' }}>{hrs(left)}</span>
            <span className="text-xs muted">hours remaining</span>
          </span>
          <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
            <span className="font-bold">{hrs(L.total_hours_consumed)}</span>
            <span className="text-xs muted">used</span>
          </span>
          <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-card-alt)' }}>
            <span className="font-bold">{hrs(L.total_hours_credited)}</span>
            <span className="text-xs muted">credited</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Hero({ student: s, ledger: L }: { student: any; ledger: any }) {
  const left = Number(L?.hours_left) || 0;
  const used = Number(L?.total_hours_consumed) || 0;
  const credited = Number(L?.total_hours_credited) || 0;
  // Same threshold as the statement page.
  const low = left <= 5;
  const leftPct = credited > 0 ? Math.max(0, Math.min(100, (left / credited) * 100)) : 0;
  const R = 48, C = 2 * Math.PI * R;
  const leftText = left.toLocaleString('en-AE', { maximumFractionDigits: 2 });
  // Bold digits are ~0.6em wide; these keep any length inside ~70px.
  const leftSize = leftText.length <= 3 ? 30 : leftText.length === 4 ? 25 : leftText.length === 5 ? 21 : leftText.length === 6 ? 18 : 15;
  const meta = [s.year_grade, s.exam_board, s.form_no ? `Form ${s.form_no}` : null].filter(Boolean);

  return (
    <div className="hero-ink rounded-3xl p-5 sm:p-6 overflow-hidden relative ring-1 ring-white/[0.06]">
      {/* The name gets the full width and may wrap — a long name is never cut. */}
      <h1 className="text-xl sm:text-2xl font-bold leading-snug line-clamp-2 break-words">{s.full_name}</h1>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {/* StatusBadge's colours are for a light card; on the ink a dot reads better. */}
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-white/10">
          <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'Active' ? 'bg-emerald-400' : s.status === 'Trial' ? 'bg-violet-400' : 'bg-slate-400'}`} />
          {s.status}
        </span>
        {meta.map((m) => (
          <span key={m} className="text-xs font-medium px-2 py-0.5 rounded-md bg-white/10 text-white/80">{m}</span>
        ))}
      </div>

      <div className="flex items-center gap-5 sm:gap-8 mt-6">
        {/* 128px ring, 8-unit stroke: the hole is ~96px across. The number
            steps down in size as it gets longer so it never reaches the stroke. */}
        <div className="relative shrink-0 w-[128px] h-[128px] sm:w-[140px] sm:h-[140px]">
          <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90" aria-hidden>
            <circle cx="56" cy="56" r={R} fill="none" strokeWidth="8" stroke="rgba(255,255,255,0.12)" />
            {/* At 0% the round cap alone would draw a stray dot, so no arc at all. */}
            {leftPct > 0 && (
              <circle cx="56" cy="56" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
                stroke={low ? '#f87171' : '#fb923c'} strokeDasharray={`${(leftPct / 100) * C} ${C}`}
                style={{ transition: 'stroke-dasharray 0.8s ease' }} />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="max-w-[78px] font-display font-bold leading-none tnum whitespace-nowrap" style={{ fontSize: leftSize }}>
              {leftText}
            </div>
            <div className="text-[11px] leading-none text-white/60 mt-1.5">hours left</div>
          </div>
        </div>

        <dl className="flex-1 min-w-0 max-w-[260px] grid gap-3">
          <div>
            <dt className="text-xs text-white/55">Used</dt>
            <dd className="font-display text-lg font-semibold tnum">{hrs(used)}</dd>
          </div>
          <div className="h-px bg-white/10" />
          <div>
            <dt className="text-xs text-white/55">Bought in total</dt>
            <dd className="font-display text-lg font-semibold tnum">{hrs(credited)}</dd>
          </div>
        </dl>
      </div>

      {low && (
        <div className="mt-5 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm bg-red-400/15 text-red-100">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-300" />
          <span>
            {left < 0
              ? `${hrs(-left)} used beyond what was bought. Contact the institute to add hours.`
              : 'Running low on hours. Contact the institute to add more.'}
          </span>
        </div>
      )}
    </div>
  );
}
