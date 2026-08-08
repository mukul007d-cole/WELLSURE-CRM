import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { usePreferences, type TableDensity } from '../../app/preferences';
import { useSignOut } from '../../app/use-sign-out';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { Select } from '../../components/ui/Select';
import { AdminHeader } from '../admin/shared';

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      <p className="mt-0.5 text-sm text-ink-soft">{description}</p>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-b-0">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

export function SettingsPage() {
  const { user, capabilities } = useAuth();
  const { sidebarCollapsed, setSidebarCollapsed, tableDensity, setTableDensity } = usePreferences();
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);

  // Nothing on this page is fetched, so there is nothing for refresh to reload.
  usePageChrome('Settings', []);

  const grantsByModule = new Map<string, string[]>();
  for (const grant of capabilities?.permissions ?? []) {
    grantsByModule.set(grant.module, [...(grantsByModule.get(grant.module) ?? []), grant.action]);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <AdminHeader title="Settings" description="Your profile, access, and how this app looks." />

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsCard
          title="Your profile"
          description="Managed by an administrator — ask one to change these."
        >
          {user ? (
            <>
              <div className="mb-3 flex items-center gap-3">
                <RingAvatar name={user.name} size={44} />
                <div>
                  <p className="font-display text-base font-semibold text-ink">{user.name}</p>
                  <p className="text-sm text-ink-soft">{user.roleName}</p>
                </div>
              </div>
              <ReadOnlyRow label="Email" value={user.email} />
              <ReadOnlyRow label="Role" value={user.roleName} />
            </>
          ) : null}
        </SettingsCard>

        <SettingsCard
          title="Your access"
          description="What your role currently grants you across the app."
        >
          <ReadOnlyRow
            label="Journeys you can access"
            value={String(capabilities?.journeyIds.length ?? 0)}
          />
          <ReadOnlyRow
            label="Fields with explicit visibility"
            value={String(capabilities?.fieldVisibility.length ?? 0)}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Permissions by module ({grantsByModule.size})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {[...grantsByModule.entries()].map(([module, actions]) => (
                <li key={module} className="text-sm">
                  {/* Module and action names come from the API payload. */}
                  <span className="font-medium text-ink">{module}</span>{' '}
                  <span className="text-ink-soft">{actions.join(', ')}</span>
                </li>
              ))}
              {grantsByModule.size === 0 ? (
                <li className="text-sm text-ink-soft">No permissions granted.</li>
              ) : null}
            </ul>
          </details>
        </SettingsCard>

        <SettingsCard
          title="Appearance"
          description="Saved in this browser only — these aren't synced to your account."
        >
          <div className="space-y-4">
            <Checkbox
              label="Start with the sidebar collapsed"
              checked={sidebarCollapsed}
              onChange={(event) => setSidebarCollapsed(event.target.checked)}
            />
            <div>
              <label htmlFor="table-density" className="mb-1 block text-sm font-medium text-ink">
                Table density
              </label>
              <Select
                id="table-density"
                className="w-48"
                value={tableDensity}
                onChange={(event) => setTableDensity(event.target.value as TableDensity)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </Select>
              <p className="mt-1 text-xs text-ink-soft">Affects table rows on larger screens.</p>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title="Session" description="You're signed in on this device.">
          {user ? <ReadOnlyRow label="Signed in as" value={user.email} /> : null}
          <Button
            className="mt-4"
            variant="secondary"
            loading={signingOut}
            onClick={() => void handleSignOut()}
          >
            Sign out
          </Button>
        </SettingsCard>
      </div>

      <p className="text-xs text-ink-soft">
        Organisation and notification preferences aren&rsquo;t available in this release.
      </p>
    </div>
  );
}
