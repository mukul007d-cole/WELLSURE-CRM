import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { DataCell, DataRow, DataTable, RowActions } from '../../components/ui/DataTable';
import { attachmentsApi, type LeadContext } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';

/** Bytes as something a person reads. */
function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function DocumentLockerTab({
  leadId,
  journeyContext,
}: {
  leadId: string;
  journeyContext: LeadContext | null;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const key = qk.sellerAttachments(leadId);
  const list = useQuery({
    queryKey: key,
    queryFn: () => attachmentsApi.list(leadId, journeyContext!),
    enabled: Boolean(journeyContext),
    retry: false,
  });

  const upload = useMutation({
    mutationFn: (input: { file: File; name: string }) =>
      attachmentsApi.upload(leadId, journeyContext!, input),
    onSuccess: async () => {
      setName('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await qc.invalidateQueries({ queryKey: key });
    },
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => attachmentsApi.remove(attachmentId, journeyContext!),
    onSuccess: async () => qc.invalidateQueries({ queryKey: key }),
  });

  const download = useMutation({
    mutationFn: async (input: { id: string; fileName: string }) => {
      const result = await attachmentsApi.download(input.id, journeyContext!);
      // Nothing else in the app downloads a file, so this is the one place
      // that builds and revokes an object URL.
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName ?? input.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  // 503 means this deployment has no object storage configured — a different
  // thing from an empty locker, and the operator needs to know which.
  const notConfigured = list.error instanceof ApiError && list.error.status === 503;
  if (notConfigured) {
    return (
      <EmptyState
        title="Document storage isn’t configured"
        description="This deployment has no object storage connected, so documents can’t be uploaded or retrieved. Run `pnpm infra:up` locally, or set the S3 environment variables."
      />
    );
  }
  if (list.error instanceof ApiError && list.error.status === 403) {
    return (
      <EmptyState
        title="Documents aren’t visible to your role"
        description="You can see this seller, but not the documents filed against it."
      />
    );
  }

  const items = list.data ?? [];
  const actionError = upload.error ?? remove.error ?? download.error ?? list.error;

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <Banner tone="error">{friendlyErrorMessage(actionError)}</Banner> : null}

      {can('attachments', 'upload') ? (
        <form
          className="flex flex-col gap-3 rounded-card border border-line bg-surface-sunken p-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            upload.mutate({ file, name: name.trim() || file.name });
          }}
        >
          <div className="flex-1">
            <label htmlFor="document-name" className="mb-1 block text-xs font-medium text-ink-soft">
              Document name
            </label>
            <Input
              id="document-name"
              value={name}
              placeholder={file?.name ?? 'e.g. Signed agreement'}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="document-file" className="mb-1 block text-xs font-medium text-ink-soft">
              File
            </label>
            <input
              id="document-file"
              ref={fileInput}
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="w-full text-sm text-ink-muted file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-paper"
            />
          </div>
          <Button type="submit" disabled={!file || upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </form>
      ) : null}

      {list.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading documents">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description={
            can('attachments', 'upload')
              ? 'Give a document a name, choose a file, and upload it.'
              : 'Nothing has been filed against this seller.'
          }
        />
      ) : (
        <DataTable
          headers={[
            'Name',
            'Size',
            'Uploaded by',
            'When',
            { label: 'Actions', align: 'right' as const },
          ]}
          caption="Documents filed against this seller"
          maxHeightClass="max-h-[26rem]"
        >
          {items.map((item) => (
            <DataRow key={item.id}>
              <DataCell primary>{item.fileName}</DataCell>
              <DataCell>{formatSize(item.sizeBytes)}</DataCell>
              <DataCell>{item.uploadedByName ?? 'System'}</DataCell>
              <DataCell>{new Date(item.uploadedAt).toLocaleDateString()}</DataCell>
              <DataCell align="right">
                <RowActions>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => download.mutate({ id: item.id, fileName: item.fileName })}
                  >
                    Download
                  </Button>
                  {can('attachments', 'delete') ? (
                    <Button size="sm" variant="danger" onClick={() => remove.mutate(item.id)}>
                      Delete
                    </Button>
                  ) : null}
                </RowActions>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
