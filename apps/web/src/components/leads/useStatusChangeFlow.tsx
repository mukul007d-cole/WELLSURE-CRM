import { useState, type ReactNode } from 'react';
import { StatusChangeDialog, type StatusChangeSubject } from './StatusChangeDialog';
import { needsStatusEntryPrompt, type StatusEntryValues } from './status-entry';

interface Prompt<T> {
  /** Remounts the dialog per prompt, so its drafts start from `entry`. */
  id: number;
  variables: T;
  entry: StatusEntryValues | undefined;
  missingFieldIds: readonly string[] | null;
}

/**
 * The one status-change flow every status control goes through.
 *
 * `request` either saves straight away (a status with no ADR-0026 extras —
 * still one click) or opens `StatusChangeDialog` first; `promptForFields`
 * re-opens it after the server names Fields that are still empty. Saving is
 * left to the caller's `submit`, so each surface keeps its own mutation and
 * cache strategy. `T` is whatever that mutation takes; `subject` reads the
 * lead and the move out of it for the dialog.
 */
export function useStatusChangeFlow<T>(options: {
  subject: (variables: T) => StatusChangeSubject;
  submit: (variables: T, entry: StatusEntryValues | undefined) => void;
  knownFieldValues?: Readonly<Record<string, unknown>> | undefined;
  onCancel?: (variables: T) => void;
}): {
  request: (variables: T) => void;
  promptForFields: (
    variables: T,
    entry: StatusEntryValues | undefined,
    fieldIds: readonly string[],
  ) => void;
  dialog: ReactNode;
} {
  const [prompt, setPrompt] = useState<Prompt<T> | null>(null);

  const request = (variables: T) => {
    if (needsStatusEntryPrompt(options.subject(variables).toStatus)) {
      setPrompt((current) => ({
        id: (current?.id ?? 0) + 1,
        variables,
        entry: undefined,
        missingFieldIds: null,
      }));
    } else {
      options.submit(variables, undefined);
    }
  };

  const promptForFields = (
    variables: T,
    entry: StatusEntryValues | undefined,
    fieldIds: readonly string[],
  ) =>
    setPrompt((current) => ({
      id: (current?.id ?? 0) + 1,
      variables,
      entry,
      missingFieldIds: fieldIds,
    }));

  const dialog = prompt ? (
    <StatusChangeDialog
      key={prompt.id}
      subject={options.subject(prompt.variables)}
      initial={prompt.entry}
      missingFieldIds={prompt.missingFieldIds}
      knownFieldValues={options.knownFieldValues}
      onCancel={() => {
        setPrompt(null);
        options.onCancel?.(prompt.variables);
      }}
      onSubmit={(entry) => {
        setPrompt(null);
        options.submit(prompt.variables, entry);
      }}
    />
  ) : null;

  return { request, promptForFields, dialog };
}
