import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '../../api/client';
import { Section } from '../../components/ui';
import { Select } from '../../components/Select';
import { AttendanceInbox } from '../../components/AttendanceInbox';
import { toast } from '../../components/Toast';
import { printQrCards } from '../../lib/qr';

/**
 * Check-ins across the institute. The office can work any teacher's inbox when
 * the teacher has not, and print the whole set of desk codes in one go.
 */
export default function AdminAttendance() {
  const [teacherId, setTeacherId] = useState('');

  const teachers = useQuery({
    queryKey: ['teachers'],
    queryFn: () => api.get('/teachers').then((r) => r.data.data as any[]),
  });

  const options = useMemo(
    () => (teachers.data || []).map((t: any) => ({ value: String(t.id), label: t.name })),
    [teachers.data]
  );

  const chosen = (teachers.data || []).find((t: any) => String(t.id) === teacherId);

  async function printAll() {
    const r = await api.get('/teachers/qr-codes');
    const cards = (r.data.data as any[]).filter((c) => c.code).map((c) => ({ name: c.name, code: c.code }));
    if (!cards.length) return toast('No teachers to print.', 'error');
    const opened = await printQrCards(cards);
    if (!opened) toast('The print window was blocked. Allow pop-ups for this site.', 'error');
  }

  return (
    <div className="space-y-4">
      <Section
        title="Attendance"
        action={
          <>
            <div className="w-56">
              <Select
                compact
                value={teacherId}
                onChange={setTeacherId}
                options={options}
                placeholder="All teachers"
              />
            </div>
            {teacherId && (
              <button className="btn-outline !py-1 !px-2.5 text-xs" onClick={() => setTeacherId('')}>
                All teachers
              </button>
            )}
            <button className="btn-outline !py-1 !px-2.5 text-xs" onClick={printAll}>
              <Printer className="w-3.5 h-3.5" /> Print all QR codes
            </button>
          </>
        }
      >
        <p className="muted text-sm">
          Every scan a student makes lands here as its own row. Pick a teacher to
          work their inbox, or leave it on all teachers to see everything waiting.
        </p>
      </Section>

      <AttendanceInbox
        admin
        teacherId={teacherId ? Number(teacherId) : undefined}
        teacherName={chosen?.name}
      />
    </div>
  );
}
