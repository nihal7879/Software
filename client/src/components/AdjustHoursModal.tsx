import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

// Admin modal to add/deduct hours from a student's balance — e.g. to correct a
// missed lecture entry (deduct) or grant extra hours (add).
export function AdjustHoursModal({
  studentId,
  studentName,
  onClose,
  onSaved,
}: {
  studentId: number;
  studentName: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [hours, setHours] = useState('');
  const [mode, setMode] = useState<'add' | 'deduct'>('deduct');
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const magnitude = Math.abs(Number(hours));
      const delta = mode === 'deduct' ? -magnitude : magnitude;
      return api.post(`/fees/ledger/${studentId}/adjust-hours`, { delta, reason: reason || null });
    },
    onSuccess: () => {
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

  const valid = Number(hours) > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Adjust Hours</h2>
          <button className="btn-ghost !py-1 !px-2.5 text-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted text-sm mb-4">{studentName}</p>

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

        <label className="text-xs font-medium muted block mt-3">Reason (optional)</label>
        <input
          className="input mt-1"
          placeholder="e.g. missed lecture entry on 12 Jun"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <p className="muted text-xs mt-3">
          {mode === 'deduct'
            ? 'Reduces the student’s remaining hours (use when a class was not logged).'
            : 'Increases the student’s remaining hours.'}
        </p>

        {save.isError && (
          <div className="text-sm text-red-500 mt-3">
            {(save.error as any)?.response?.data?.error || 'Could not adjust — please try again.'}
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <button className="btn-primary flex-1" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : mode === 'deduct' ? 'Deduct Hours' : 'Add Hours'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
