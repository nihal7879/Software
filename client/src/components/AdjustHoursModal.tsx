import { useState } from 'react';
import { Overlay } from './Overlay';
import { CalendarPicker } from './CalendarPicker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { toast } from './Toast';

/** An adjustment already on the statement, when this modal is correcting one. */
export type AdjustmentRow = { id: number; delta: number | string; reason?: string | null; adjusted_on?: string | null };

// Admin modal to add/deduct hours from a student's balance — e.g. to correct a
// missed lecture entry (deduct) or grant extra hours (add). Passing `editing`
// turns it into a correction of that entry instead of a new one.
export function AdjustHoursModal({
  studentId,
  studentName,
  editing,
  onClose,
  onSaved,
}: {
  studentId: number;
  studentName: string;
  editing?: AdjustmentRow | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const startDelta = Number(editing?.delta || 0);
  const [hours, setHours] = useState(editing ? String(Math.abs(startDelta)) : '');
  const [mode, setMode] = useState<'add' | 'deduct'>(
    editing ? (startDelta < 0 ? 'deduct' : 'add') : 'deduct'
  );
  const [reason, setReason] = useState(editing?.reason || '');
  // The day the adjustment is FOR — often not today. Left empty it sits on the
  // day it was entered, which is how every existing entry behaves.
  const [onDate, setOnDate] = useState(String(editing?.adjusted_on || '').slice(0, 10));
  // Set when the change went to the super admin instead of onto the statement.
  // The dialog stays open showing this, because closing it on a statement that
  // has not moved reads as though the save failed.
  const [sent, setSent] = useState<string | null>(null);
  // Two different notes, and they must not be confused. `reason` is printed
  // beside the entry on the statement and the family reads it. This one is the
  // case the office makes to the super admin, and goes no further than the
  // approval queue.
  const { user } = useAuth();
  const mustExplain = user?.role !== 'superadmin';
  const [requestNote, setRequestNote] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const magnitude = Math.abs(Number(hours));
      const delta = mode === 'deduct' ? -magnitude : magnitude;
      const body = {
        delta, reason: reason || null, adjusted_on: onDate || null,
        ...(mustExplain ? { request_note: requestNote.trim() } : {}),
      };
      return editing
        ? api.put(`/fees/adjustments/entry/${editing.id}`, body)
        : api.post(`/fees/ledger/${studentId}/adjust-hours`, body);
    },
    onSuccess: (res: any) => {
      if (res?.status === 202 || res?.data?.pending) {
        const msg = res?.data?.message || 'Sent to the super admin for approval.';
        setSent(msg);
        toast(msg, 'info');
        return;
      }
      const amount = Math.abs(Number(hours));
      toast(
        editing ? 'Adjustment updated.'
        : mode === 'deduct' ? `${amount} hours deducted.`
        : `${amount} hours added.`
      );
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['ledger-all'] });
      qc.invalidateQueries({ queryKey: ['pkg'] });
      qc.invalidateQueries({ queryKey: ['adjustments'] });
      qc.invalidateQueries({ queryKey: ['student-report'] });
      qc.invalidateQueries({ queryKey: ['mgmt-master'] });
      onSaved?.();
      onClose();
    },
  });

  // What is stopping the save, in the order the eye reads the form. The button
  // stays alive and says this when pressed - a greyed-out button that gives no
  // reason leaves you guessing which field it wants.
  const problem =
    !(Number(hours) > 0) ? 'Enter the number of hours.'
    : mustExplain && requestNote.trim().length < 5 ? 'Please write why you need this change.'
    : '';
  const [error, setError] = useState('');

  return (
    <Overlay align="center" onClose={onClose}>
      <div className="card w-full max-w-sm p-6 max-h-[85vh] overflow-y-auto thin-scroll" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">
            {sent ? 'Sent for approval' : editing ? 'Edit Adjustment' : 'Adjust Hours'}
          </h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">{studentName}</p>

        {sent ? (
          <>
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold mb-1">
                    {mode === 'deduct' ? '−' : '+'}{Math.abs(Number(hours))} hours waiting for the super admin
                  </div>
                  <p className="muted">{sent}</p>
                </div>
              </div>
            </div>
            <p className="muted text-xs mt-3">
              The statement is unchanged for now. Once it is approved the hours appear
              here by themselves — nothing more to do.
            </p>
            <button className="btn-primary w-full mt-4" onClick={onClose}>Done</button>
          </>
        ) : (
        <>

        <div className="flex gap-2 mb-3">
          <button
            type="button"
            className={mode === 'deduct' ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
            onClick={() => setMode('deduct')}
          >
            − Deduct
          </button>
          <button
            type="button"
            className={mode === 'add' ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
            onClick={() => setMode('add')}
          >
            + Add
          </button>
        </div>

        <label className="text-xs font-medium muted">Hours</label>
        <input
          className="input mt-1"
          type="number"
          step="0.25"
          min="0"
          placeholder="0"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />

        <label className="text-xs font-medium muted block mt-3">Date (optional)</label>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1"><CalendarPicker value={onDate} onChange={setOnDate} placeholder="Pick a date…" /></div>
          {onDate && (
            <button type="button" className="btn-ghost !py-1.5 !px-3 text-sm whitespace-nowrap" onClick={() => setOnDate('')}>
              Clear
            </button>
          )}
        </div>

        <label className="text-xs font-medium muted block mt-3">Reason (optional)</label>
        <input
          className="input mt-1"
          placeholder="e.g. missed lecture entry on 12 Jun"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        {mustExplain && (
          <>
            <label className="text-xs font-medium muted block mt-3">
              Why do you need this change? <span className="text-red-500">*</span>
            </label>
            <textarea
              className="input mt-1 min-h-[64px]"
              placeholder="e.g. Mrs Khan called, we cancelled her 12 June class"
              value={requestNote}
              maxLength={500}
              onChange={(e) => setRequestNote(e.target.value)}
            />
            <p className="muted text-xs mt-1">
              Only the super admin will see this. The student and parent will not see it.
            </p>
          </>
        )}

        {save.isError && (
          <div className="text-sm text-red-500 mt-3">
            {(save.error as any)?.response?.data?.error || 'Could not adjust — please try again.'}
          </div>
        )}

        {error && <div className="text-sm text-red-500 mt-3">{error}</div>}

        <div className="flex gap-2 pt-4">
          <button
            className="btn-primary flex-1"
            disabled={save.isPending}
            onClick={() => (problem ? setError(problem) : (setError(''), save.mutate()))}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save Changes' : mode === 'deduct' ? 'Deduct Hours' : 'Add Hours'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
        </>
        )}
      </div>
    </Overlay>
  );
}
