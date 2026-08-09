import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { SearchableSelect } from '../admin/SearchableSelect';
import type { Seller360ProcessInstance } from '../../types/domain';

export function ReassignDialog({
  processes,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  processes: Seller360ProcessInstance[];
  onClose: () => void;
  onSubmit: (input: { processInstanceId: string; assignmentType: string; userId: string }) => void;
  pending: boolean;
  error: unknown;
}) {
  const [processInstanceId, setProcessInstanceId] = useState(processes[0]?.processInstanceId ?? '');
  const [assignmentType, setAssignmentType] = useState('');
  const [userId, setUserId] = useState('');

  const selected = processes.find((row) => row.processInstanceId === processInstanceId);
  // The assignment types on this journey are whatever the record already
  // carries — never a hardcoded "owner".
  const assignmentTypes = selected?.assignments.map((row) => row.assignmentType) ?? [];
  const effectiveType = assignmentType || (assignmentTypes[0] ?? '');
  const canSubmit = Boolean(processInstanceId && effectiveType && userId) && !pending;

  return (
    <Dialog
      title="Reassign seller"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => onSubmit({ processInstanceId, assignmentType: effectiveType, userId })}
          >
            {pending ? 'Reassigning…' : 'Reassign'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {processes.length > 1 ? (
          <Field label="Journey">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={processInstanceId}
                onChange={(event) => {
                  setProcessInstanceId(event.target.value);
                  setAssignmentType('');
                }}
              >
                {processes.map((process) => (
                  <option key={process.processInstanceId} value={process.processInstanceId}>
                    {process.journey.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {assignmentTypes.length === 0 ? (
          <Banner tone="info">
            This journey has no assignment to transfer, so there is nothing to reassign.
          </Banner>
        ) : (
          <Field label="Assignment">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={effectiveType}
                onChange={(event) => setAssignmentType(event.target.value)}
              >
                {assignmentTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label="New assignee">
          {({ inputId }) => (
            <SearchableSelect
              id={inputId}
              value={userId}
              onChange={setUserId}
              loadPage={(page) => adminApi.users({ page, active: true })}
              placeholder="Search people…"
            />
          )}
        </Field>

        {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      </div>
    </Dialog>
  );
}
