import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { usePreferences, type TableDensity } from '../../app/preferences';
import { useSignOut } from '../../app/use-sign-out';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { Select } from '../../components/ui/Select';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Banner } from '../../components/ui/Banner';
import { authApi, guidesApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage, passwordPolicyErrorMessage } from '../../lib/api-error';
import { PageBody, PageHeader, SectionCard } from '../../components/layout/PageFrame';
import { GuideDialog } from './GuideDialog';

function GuideRow({
  guide,
  title,
  description,
  onView,
}: {
  guide: 'admin' | 'user';
  title: string;
  description: string;
  onView: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { content, fileName } = await guidesApi.get(guide);
      const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-soft">{description}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onView}>
          View
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={downloading}
          onClick={() => void handleDownload()}
        >
          Download
        </Button>
      </div>
    </div>
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
  const { user, capabilities, can } = useAuth();
  const { sidebarCollapsed, setSidebarCollapsed, tableDensity, setTableDensity } = usePreferences();
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{
    tone: 'error' | 'success';
    text: string;
  } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  // `null` means "no local override — show whatever the server last said."
  // Avoids syncing local state from `user` (which loads asynchronously) via
  // an effect; the displayed value is derived at render time instead, with
  // this holding only an optimistic in-flight/rolled-back override.
  const [pendingRetainView, setPendingRetainView] = useState<boolean | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [openGuide, setOpenGuide] = useState<'admin' | 'user' | null>(null);
  const retainViewAfterReassignment =
    pendingRetainView ?? user?.retainViewAfterReassignment ?? false;

  async function handleRetainViewToggle(checked: boolean) {
    setPendingRetainView(checked);
    setSavingPreference(true);
    setPreferenceError(null);
    try {
      await authApi.updatePreferences(checked);
    } catch (error) {
      setPendingRetainView(null);
      setPreferenceError(friendlyErrorMessage(error));
    } finally {
      setSavingPreference(false);
    }
  }

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

  async function handlePasswordChange(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setPasswordMessage({ tone: 'error', text: 'The password confirmation does not match.' });
      return;
    }
    setChangingPassword(true);
    setPasswordMessage(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setPasswordMessage({
        tone: 'success',
        text: 'Password changed. Your other signed-in sessions were ended.',
      });
    } catch (error) {
      setPasswordMessage({
        tone: 'error',
        text:
          error instanceof ApiError && error.code === 'weak_password'
            ? passwordPolicyErrorMessage(error)
            : friendlyErrorMessage(error),
      });
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <PageBody>
      <PageHeader title="Settings" description="Your profile, access, and how this app looks." />

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
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
        </SectionCard>

        <SectionCard
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
        </SectionCard>

        {can('leads', 'retain_view_after_reassignment') ? (
          <SectionCard
            title="Lead reassignment"
            description="What happens when a lead is moved off you."
          >
            {preferenceError ? <Banner tone="error">{preferenceError}</Banner> : null}
            <Checkbox
              label="Keep view-only access for 30 days after a lead is reassigned away from me"
              checked={retainViewAfterReassignment}
              disabled={savingPreference}
              onChange={(event) => void handleRetainViewToggle(event.target.checked)}
            />
            <p className="mt-1 text-xs text-ink-soft">
              If a lead is reassigned away from you — manually or by Status Routing — you&rsquo;ll
              keep view-only access to it for 30 days so you can see how it progresses.
            </p>
          </SectionCard>
        ) : null}

        <SectionCard title="Guides" description="Reference documentation for this workspace.">
          <GuideRow
            guide="user"
            title="User Guide"
            description="Working leads day to day: the Seller List, the Board, and a seller's own record."
            onView={() => setOpenGuide('user')}
          />
          {can('roles_permissions', 'view') ? (
            <GuideRow
              guide="admin"
              title="Admin Guide"
              description="Configuring the workspace: Journeys, Fields, Roles, Users, routing, and more."
              onView={() => setOpenGuide('admin')}
            />
          ) : null}
        </SectionCard>

        <SectionCard
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
        </SectionCard>

        <SectionCard title="Session" description="You're signed in on this device.">
          {user ? <ReadOnlyRow label="Signed in as" value={user.email} /> : null}
          <Button
            className="mt-4"
            variant="secondary"
            loading={signingOut}
            onClick={() => void handleSignOut()}
          >
            Sign out
          </Button>
        </SectionCard>

        <SectionCard
          title="Change password"
          description="Confirm your current password. Other signed-in devices will be signed out."
        >
          <form className="space-y-3" onSubmit={(event) => void handlePasswordChange(event)}>
            {passwordMessage ? (
              <Banner tone={passwordMessage.tone}>{passwordMessage.text}</Banner>
            ) : null}
            <Field label="Current password" required>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              )}
            </Field>
            <Field label="New password" required>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              )}
            </Field>
            <Field label="Confirm new password" required>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              )}
            </Field>
            <Button type="submit" loading={changingPassword}>
              Change password
            </Button>
          </form>
        </SectionCard>
      </div>

      <p className="text-xs text-ink-soft">
        Organisation and notification preferences aren&rsquo;t available in this release.
      </p>

      {openGuide ? (
        <GuideDialog
          guide={openGuide}
          title={openGuide === 'admin' ? 'Admin Guide' : 'User Guide'}
          onClose={() => setOpenGuide(null)}
        />
      ) : null}
    </PageBody>
  );
}
