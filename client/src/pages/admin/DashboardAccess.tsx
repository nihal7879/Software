import { PanelAccessCards } from '../../components/PanelAccessCards';

/**
 * Who can see their dashboard — the super admin's own screen.
 *
 * It lived inside Settings, below the profile, which is where a switch that
 * shuts a whole audience out is least likely to be found and most likely to
 * be left on by mistake. It has its own place in the menu now, with the state
 * of all three readable at a glance.
 */
export default function DashboardAccess() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Dashboard access</h1>
        <p className="muted text-sm">
          Lock a group out of their figures while the books are being corrected. Signing in, the
          profile and changing a password stay open — and the office is never locked out, because
          somebody has to be able to see the numbers in order to fix them.
        </p>
      </div>
      <PanelAccessCards />
    </div>
  );
}
