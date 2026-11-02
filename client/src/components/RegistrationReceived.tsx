import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { RegisterLayout } from './RegisterLayout';

/**
 * After a teacher or parent registers. They are not signed in: the request waits
 * for the office, as a student's does, and this says so plainly — with the
 * username to sign in with once it is approved.
 */
export function RegistrationReceived({ name, username }: { name: string; username: string }) {
  return (
    <RegisterLayout eyebrow="Registration received" title={`Thank you, ${name}`} showSignInLink={false}>
      <CheckCircle2 size={44} className="text-emerald-500 mb-4" />
      <div className="text-sm rounded-lg px-4 py-3 mb-6 bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Your registration is <b>waiting for the administrator to confirm</b>. Once it is approved you can sign in
        with the username <b>{username}</b> and the password you just set.
      </div>
      <Link to="/login" className="btn-primary w-full !py-3 inline-flex justify-center">← Back to sign in</Link>
    </RegisterLayout>
  );
}
