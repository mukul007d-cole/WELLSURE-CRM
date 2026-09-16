import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { useUnsavedDraft } from '../../app/use-unsaved-changes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { RichTextComposer } from '../../components/ui/RichTextComposer';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { adminApi, toolsApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { emptyDocument } from '../../lib/structured-document';
import type { CampaignDocument, Resource, ResourceType } from '../../types/domain';
import {
  ActiveFilter,
  ADMIN_PAGE_SIZE,
  AdminTable,
  activeValue,
  loadAllPages,
} from '../admin/shared';

type ResourceDraft = {
  id?: string;
  name: string;
  description: string;
  category: string;
  type: ResourceType;
  url: string;
  instructions: CampaignDocument;
  /** Set only when the admin is uploading a new/replacement file this save. */
  file?: File;
  /** The currently-stored file's name, shown when editing a `file` Resource with no new upload chosen. */
  existingFileName: string | null;
  /** Roles granted this Resource. Absent from the list means hidden. */
  roleIds: string[];
};

const emptyDraft = (): ResourceDraft => ({
  name: '',
  description: '',
  category: '',
  type: 'link',
  url: '',
  instructions: emptyDocument(),
  existingFileName: null,
  // A new Resource starts granted to nobody, matching the server's default —
  // the same reasoning Phase 13a's Field picker uses.
  roleIds: [],
});

const fromResource = (resource: Resource): ResourceDraft => ({
  id: resource.id,
  name: resource.name,
  description: resource.description ?? '',
  category: resource.category ?? '',
  type: resource.type,
  url: resource.url ?? '',
  instructions: resource.instructions ?? emptyDocument(),
  existingFileName: resource.fileName,
  // Filled in by the caller from the Resource's stored grants.
  roleIds: [],
});

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function ToolsPage() {
  usePageChrome('Tools', [['tools']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const canAdminister = can('tools', 'create') || can('tools', 'edit') || can('tools', 'delete');
  const canGrant = can('roles_permissions', 'edit');
  const canSeeGrants = canGrant || can('roles_permissions', 'view');

  const [adminMode, setAdminMode] = useState(false);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [pristine, setPristine] = useState<ResourceDraft | null>(null);
  const [deactivating, setDeactivating] = useState<Resource | null>(null);
  useUnsavedDraft(draft, pristine);

  const openDraft = (next: ResourceDraft) => {
    setSyncedVisibilityResourceId(null);
    setDraft(next);
    setPristine(next);
  };
  const closeDraft = () => {
    setDraft(null);
    setPristine(null);
  };

  const browse = useQuery({
    queryKey: ['tools', 'browse'],
    queryFn: () => loadAllPages((page, pageSize) => toolsApi.list({ page, pageSize })),
    enabled: !adminMode,
  });
  const adminList = useQuery({
    queryKey: ['tools', 'admin', page, active],
    queryFn: () =>
      toolsApi.list({ admin: true, active: activeValue(active), page, pageSize: ADMIN_PAGE_SIZE }),
    enabled: adminMode,
  });
  // Every active Resource, unpaginated — only for the editor's Category
  // autocomplete, matching FieldsPage's `allFields` need exactly.
  const allResources = useQuery({
    queryKey: ['tools', 'admin-all'],
    queryFn: () => loadAllPages((page, pageSize) => toolsApi.list({ admin: true, page, pageSize })),
    enabled: draft !== null && canAdminister,
  });
  // Every Role, not just the active ones: a deactivated Role keeps its
  // resource_visibility rows, and a picker that couldn't show them would drop
  // them silently on the next full-replace save.
  const roles = useQuery({
    queryKey: ['admin', 'roles', 'tool-editor'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, undefined, pageSize)),
    enabled: draft !== null && canSeeGrants,
  });
  // An existing Resource's grants load after the editor opens, then seed the
  // draft once — the same load-and-sync shape FieldsPage uses.
  const visibility = useQuery({
    queryKey: ['tools', 'visibility', draft?.id],
    queryFn: () => toolsApi.visibility(draft?.id ?? ''),
    enabled: Boolean(draft?.id) && canSeeGrants,
  });
  const [syncedVisibilityResourceId, setSyncedVisibilityResourceId] = useState<string | null>(null);
  if (draft?.id && visibility.data && syncedVisibilityResourceId !== draft.id) {
    setSyncedVisibilityResourceId(draft.id);
    const hydrated = { ...draft, roleIds: visibility.data.roleIds };
    setDraft(hydrated);
    setPristine(hydrated);
  }
  const visibilityKnown = draft?.id === undefined || syncedVisibilityResourceId === draft.id;
  const visibilityLoading = Boolean(draft?.id) && canSeeGrants && visibility.isPending;

  const save = useMutation({
    mutationFn: async () => {
      const current = draft ?? emptyDraft();
      const input = {
        name: current.name,
        description: current.description.trim() || null,
        category: current.category.trim() || null,
        type: current.type,
        url: current.type === 'link' ? current.url : null,
        instructions: current.instructions,
        ...(current.file ? { file: current.file } : {}),
      };
      const saved = current.id
        ? await toolsApi.update(current.id, input)
        : await toolsApi.create(input);
      // Two requests, not one: the Resource itself is gated on `tools`, the
      // grants on `roles_permissions`. If this second call fails the Resource
      // exists granted to nobody — the documented default, not a half-open one.
      const writeGrants = current.id ? visibilityKnown : current.roleIds.length > 0;
      if (canGrant && writeGrants) await toolsApi.saveVisibility(saved.id, current.roleIds);
      return saved;
    },
    onSuccess: async () => {
      closeDraft();
      await qc.invalidateQueries({ queryKey: ['tools'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: toolsApi.deactivate,
    onSuccess: async () => {
      setDeactivating(null);
      await qc.invalidateQueries({ queryKey: ['tools'] });
    },
  });
  const download = useMutation({
    mutationFn: async (resource: Resource) => {
      const result = await toolsApi.download(resource.id);
      // The one place this page builds and revokes an object URL, mirroring
      // DocumentLockerTab — no persistent or shareable link anywhere.
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName ?? resource.fileName ?? 'download';
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  const categoryOptions = [
    ...new Set(
      (allResources.data ?? [])
        .map((resource) => resource.category?.trim())
        .filter((category): category is string => Boolean(category)),
    ),
  ];

  const grouped = useMemo(() => {
    const map = new Map<string, Resource[]>();
    for (const resource of browse.data ?? []) {
      const key = resource.category?.trim() || 'Uncategorized';
      const bucket = map.get(key) ?? [];
      bucket.push(resource);
      map.set(key, bucket);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [browse.data]);

  const notConfigured = download.error instanceof ApiError && download.error.status === 503;
  const error =
    browse.error ??
    adminList.error ??
    roles.error ??
    visibility.error ??
    save.error ??
    deactivate.error ??
    (notConfigured ? null : download.error);

  return (
    <PageBody>
      <PageHeader
        title="Tools"
        description="Company resource library — internal tool links, files, and usage instructions."
        actions={
          canAdminister ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setAdminMode((mode) => !mode);
                  setPage(1);
                }}
              >
                {adminMode ? 'Browse Tools' : 'Manage Tools'}
              </Button>
              {adminMode && can('tools', 'create') ? (
                <Button onClick={() => openDraft(emptyDraft())}>Add resource</Button>
              ) : null}
            </>
          ) : null
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {notConfigured ? (
        <Banner tone="error">
          This deployment has no object storage connected, so files can’t be uploaded or downloaded.
        </Banner>
      ) : null}

      {draft ? (
        <ResourceEditor
          draft={draft}
          setDraft={setDraft}
          save={() => save.mutate()}
          cancel={closeDraft}
          loading={save.isPending}
          roles={roles.data ?? []}
          rolesLoading={roles.isPending || visibilityLoading}
          showVisibility={canSeeGrants}
          canEditVisibility={canGrant && visibilityKnown}
          categoryOptions={categoryOptions}
        />
      ) : null}

      {adminMode ? (
        <>
          <ActiveFilter
            id="tools-active"
            value={active}
            onChange={(value) => {
              setActive(value);
              setPage(1);
            }}
          />
          <AdminTable
            loading={adminList.isPending}
            headers={[
              'Name',
              'Type',
              'Category',
              'State',
              { label: 'Actions', align: 'right' as const },
            ]}
            empty={!adminList.isPending && !adminList.data?.items.length}
          >
            {adminList.data?.items.map((resource) => (
              <DataRow key={resource.id}>
                <DataCell primary>
                  <span className="block">{resource.name}</span>
                  {resource.description ? (
                    <span className="text-xs text-ink-soft">{resource.description}</span>
                  ) : null}
                </DataCell>
                <DataCell>{resource.type === 'link' ? 'Link' : 'File'}</DataCell>
                <DataCell>{resource.category ?? '—'}</DataCell>
                <DataCell>{resource.active ? 'Active' : 'Inactive'}</DataCell>
                <DataCell align="right">
                  <RowActions>
                    {can('tools', 'edit') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDraft(fromResource(resource))}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {can('tools', 'delete') && resource.active ? (
                      <Button size="sm" variant="danger" onClick={() => setDeactivating(resource)}>
                        Deactivate
                      </Button>
                    ) : null}
                  </RowActions>
                </DataCell>
              </DataRow>
            ))}
          </AdminTable>
          {adminList.data ? (
            <Pagination
              page={adminList.data.page}
              pageSize={adminList.data.pageSize || ADMIN_PAGE_SIZE}
              total={adminList.data.total}
              onPageChange={setPage}
            />
          ) : null}
        </>
      ) : browse.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading Tools">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title="No Tools available"
          description="Nothing has been made accessible to your role yet."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([category, resources]) => (
            <section key={category} className="flex flex-col gap-2">
              <h3 className="font-display text-sm font-bold text-ink">{category}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {resources.map((resource) => (
                  <Card key={resource.id} className="flex flex-col gap-2 p-4">
                    <p className="font-medium text-ink">{resource.name}</p>
                    {resource.description ? (
                      <p className="text-sm text-ink-soft">{resource.description}</p>
                    ) : null}
                    {resource.type === 'file' ? (
                      <p className="text-xs text-ink-soft">
                        {resource.fileName} · {formatSize(resource.sizeBytes)}
                      </p>
                    ) : null}
                    <div>
                      {resource.type === 'link' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => window.open(resource.url ?? '', '_blank', 'noopener')}
                        >
                          Open link
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={download.isPending && download.variables?.id === resource.id}
                          onClick={() => download.mutate(resource)}
                        >
                          Download
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {deactivating ? (
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm text-ink">
            Deactivate <strong>{deactivating.name}</strong>? It will no longer be visible or
            downloadable to any role, and can be reactivated later by an admin.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={deactivate.isPending}
              onClick={() => deactivate.mutate(deactivating.id)}
            >
              Deactivate
            </Button>
            <Button variant="ghost" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </PageBody>
  );
}

function RoleAccessRow({
  role,
  granted,
  disabled,
  onChange,
}: {
  role: { id: string; name: string; active: boolean };
  granted: boolean;
  disabled: boolean;
  onChange: (granted: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-control px-2 py-1">
      <Checkbox
        label={role.name}
        disabled={disabled}
        checked={granted}
        onChange={(event) => onChange(event.target.checked)}
      />
      {role.active ? null : <span className="text-xs text-ink-soft">(inactive)</span>}
    </div>
  );
}

function ResourceEditor({
  draft,
  setDraft,
  save,
  cancel,
  loading,
  roles,
  rolesLoading,
  showVisibility,
  canEditVisibility,
  categoryOptions,
}: {
  draft: ResourceDraft;
  setDraft: (draft: ResourceDraft) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
  roles: Array<{ id: string; name: string; active: boolean }>;
  rolesLoading: boolean;
  showVisibility: boolean;
  canEditVisibility: boolean;
  categoryOptions: string[];
}) {
  const update = <K extends keyof ResourceDraft>(key: K, value: ResourceDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const setRoleGranted = (roleId: string, granted: boolean) =>
    setDraft({
      ...draft,
      roleIds: granted
        ? [...draft.roleIds.filter((id) => id !== roleId), roleId]
        : draft.roleIds.filter((id) => id !== roleId),
    });
  const saveDisabled =
    !draft.name.trim() ||
    (draft.type === 'link' && !draft.url.trim()) ||
    (draft.type === 'file' && !draft.id && !draft.file);
  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label="Name" required>
        {({ inputId }) => (
          <Input id={inputId} value={draft.name} onChange={(e) => update('name', e.target.value)} />
        )}
      </Field>
      <Field label="Type" required>
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.type}
            onChange={(e) => update('type', e.target.value as ResourceType)}
          >
            <option value="link">Link</option>
            <option value="file">File</option>
          </Select>
        )}
      </Field>
      <Field label="Description" className="sm:col-span-2">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={draft.description}
            onChange={(e) => update('description', e.target.value)}
          />
        )}
      </Field>
      <Field label="Category" hint="Groups this resource with others on the Tools tab.">
        {({ inputId }) => (
          <>
            <Input
              id={inputId}
              list="tool-category-options"
              value={draft.category}
              onChange={(e) => update('category', e.target.value)}
            />
            <datalist id="tool-category-options">
              {categoryOptions.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {draft.type === 'link' ? (
        <Field label="URL" required hint="Absolute http(s) link.">
          {({ inputId }) => (
            <Input
              id={inputId}
              type="url"
              value={draft.url}
              onChange={(e) => update('url', e.target.value)}
            />
          )}
        </Field>
      ) : (
        <Field
          label={draft.id ? 'Replace file' : 'File'}
          required={!draft.id}
          hint={
            draft.existingFileName
              ? `Current file: ${draft.existingFileName}. Choose a new one to replace it.`
              : 'Uploaded files are size- and type-limited; see the Tools admin guide.'
          }
        >
          {({ inputId }) => (
            <input
              id={inputId}
              type="file"
              onChange={(e) => update('file', e.target.files?.[0])}
              className="w-full text-sm text-ink-muted file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-paper"
            />
          )}
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Usage instructions">
          {() => (
            <RichTextComposer
              value={draft.instructions}
              onChange={(instructions) => update('instructions', instructions)}
              ariaLabel="Usage instructions"
            />
          )}
        </Field>
      </div>
      {showVisibility ? (
        <fieldset className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
            <legend className="font-display text-sm font-bold text-ink">Role access</legend>
            {canEditVisibility ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraft({ ...draft, roleIds: roles.map((role) => role.id) })}
                >
                  Grant to all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft({ ...draft, roleIds: [] })}
                >
                  Clear all
                </Button>
              </div>
            ) : null}
          </div>
          <p className="mb-2 text-xs text-ink-soft">
            Roles left unchecked cannot see or access this resource at all. New resources start
            hidden from every role.
          </p>
          {rolesLoading ? (
            <p className="text-sm text-ink-soft">Loading roles…</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {roles.map((role) => (
                <RoleAccessRow
                  key={role.id}
                  role={role}
                  granted={draft.roleIds.includes(role.id)}
                  disabled={!canEditVisibility}
                  onChange={(granted) => setRoleGranted(role.id, granted)}
                />
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
      <div className="flex items-end gap-2">
        <Button loading={loading} disabled={saveDisabled} onClick={save}>
          Save resource
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
