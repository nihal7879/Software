import { ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../api/client';
import { LectureSheet } from './LectureSheet';
import { AttendanceInbox } from './AttendanceInbox';

// One teacher's lectures in one place: the desk-QR scans, and every class
// logged — as tabs, so one list is on screen at a time. A lecture typed in by
// hand waits behind "Add lecture". Attendance used to be a separate menu item;
// the institute asked for them together, since confirming a scan is just
// another way of entering a class.
//
// The teacher's own Lecture Entry and the office's page for one teacher are
// this same screen, so the two cannot drift apart. `teacherId` is what tells
// them apart, as it is for the sheet and the inbox underneath.

// Two tabs. Confirmed scans were a third for a day; the institute preferred
// them back inside the scans, behind the inbox's own Waiting / Confirmed switch.
type Tab = 'scanned' | 'lectures';

export function LectureWorkspace({
  teacherId,
  teacherName,
  specialization,
  heading,
  headingOnPhone = false,
}: {
  /** Set when the office works a teacher's page; left out for the teacher's own. */
  teacherId?: number;
  teacherName?: string;
  specialization?: string | null;
  /** The title block, left of the Add lecture button. */
  heading: ReactNode;
  /**
   * The teacher's app bar already names the page on a phone, so their heading
   * hides there and the add button moves into the tab row. The office's phone
   * layout has no such bar, so theirs stays.
   */
  headingOnPhone?: boolean;
}) {
  const forAdmin = teacherId != null;
  const [adding, setAdding] = useState(false);
  // Scans first: they are the work still waiting to be done.
  const [tab, setTab] = useState<Tab>('scanned');

  // The same request the inbox makes for its waiting list, so this is one
  // fetch, not two — the count on the tab and the list under it always agree.
  const waiting = useQuery({
    queryKey: ['checkin-inbox', teacherId ?? 'me', 'Pending', ''],
    queryFn: () => api.get('/checkin/inbox', { params: { status: 'Pending', teacherId } }).then((r) => r.data.data as any[]),
  });
  const waitingCount = waiting.data?.length || 0;

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'scanned', label: 'Scanned check-ins', badge: waitingCount },
    { key: 'lectures', label: forAdmin ? 'Lectures' : 'My lectures' },
  ];

  const tabs = (
    // On a phone the add button rides at the end of the tab row when the
    // heading above is gone: a lone button on a line of its own looked lost.
    <div className="flex items-center gap-2">
      <div className="flex p-1 rounded-xl flex-1 min-w-0 lg:flex-none" style={{ background: 'var(--color-card-alt)' }} role="tablist">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              className={`flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-2 sm:px-4 py-2 whitespace-nowrap rounded-lg text-sm font-semibold transition ${on ? 'shadow-sm' : 'muted'}`}
              style={on ? { background: 'var(--color-card)', color: 'var(--color-primary)' } : {}}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {!!t.badge && (
                <span
                  className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 text-[11px] font-bold leading-none text-white rounded-full tabular-nums"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!adding && !headingOnPhone && (
        <button
          className="lg:hidden grid place-items-center w-11 h-11 shrink-0 rounded-xl text-white"
          style={{ background: 'linear-gradient(135deg,#fb923c,#ea580c)', boxShadow: '0 8px 18px -8px rgba(234,88,12,0.6)' }}
          onClick={() => setAdding(true)}
          aria-label="Add lecture"
          title="Add lecture"
        >
          <Plus size={20} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={`${headingOnPhone ? 'flex flex-wrap' : 'hidden lg:flex'} items-start justify-between gap-3`}>
        <div className="min-w-0">{heading}</div>
        {!adding && (
          <button className="btn-primary !py-2 !px-3.5 text-sm shrink-0 whitespace-nowrap" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add lecture
          </button>
        )}
      </div>
      <LectureSheet
        teacherId={teacherId}
        teacherName={teacherName}
        specialization={specialization ?? undefined}
        formOpen={adding}
        onCloseForm={() => setAdding(false)}
        showList={tab === 'lectures'}
        between={
          <>
            {tabs}
            {tab === 'scanned' && (
              <AttendanceInbox
                admin={forAdmin}
                teacherId={teacherId}
                teacherName={teacherName}
                specialization={specialization}
              />
            )}
          </>
        }
      />
    </div>
  );
}
