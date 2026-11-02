import { MyRequests } from '../../components/MyRequests';

// The office's own approval requests, on a menu item of their own. They sat
// behind a button on Finance at first; the institute wanted them in the menu,
// since hours changes made from Student Hours are sent for approval too.
export default function MyRequestsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My requests</h1>
        <p className="muted text-sm">Changes you sent to the super admin, and what was decided.</p>
      </div>
      <MyRequests />
    </div>
  );
}
