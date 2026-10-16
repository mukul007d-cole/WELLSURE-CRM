import { useId } from 'react';
import { Controller, type Control, type UseFormRegister } from 'react-hook-form';
import type { FieldDefinition } from '../../types/domain';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import type { FormFieldValue, LeadFormValues } from './schema';

interface DynamicFieldControlProps {
  field: FieldDefinition;
  register: UseFormRegister<LeadFormValues>;
  /** For `multi_select`, whose string[] value a native input can't hold. */
  control: Control<LeadFormValues>;
  /** Marks the label; the check itself is `leadFormSchemaFor`'s. */
  required?: boolean;
  error?: string | undefined;
  /**
   * Whether this Field should render read-only. A disabled `register()`ed
   * input is what makes this correct on submit, not just on screen: React
   * Hook Form (matching native HTML) never includes a disabled field's value
   * in the submitted values, so `toFieldValues` sends nothing for it — the
   * same "don't touch this field's value" outcome the server's own
   * `validateFieldValues` produces for `calculated`/`system` regardless, and
   * exactly what a `locked` field with an existing value needs too.
   */
  disabled?: boolean;
}

/** Why a Field is disabled, shown next to its label so it doesn't read as broken. */
function disabledHint(editMode: string): string {
  if (editMode === 'calculated') return 'Computed automatically';
  if (editMode === 'system') return 'Set by the system';
  return 'Locked — cannot be changed once set';
}

export function DynamicFieldControl({
  field,
  register,
  control,
  required = false,
  error,
  disabled = false,
}: DynamicFieldControlProps) {
  const name = `fields.${field.key}` as const;
  const hint = disabled ? disabledHint(field.editMode) : undefined;

  if (field.type === 'boolean') {
    return (
      <Checkbox
        label={hint ? `${field.label} (${hint})` : field.label}
        id={name}
        disabled={disabled}
        {...register(name)}
      />
    );
  }

  if (field.type === 'multi_select') {
    return (
      <Controller
        control={control}
        name={name}
        disabled={disabled}
        render={({ field: controlled }) => (
          <MultiSelectControl
            field={field}
            value={controlled.value}
            onChange={controlled.onChange}
            onBlur={controlled.onBlur}
            required={required}
            error={error}
            hint={hint}
            disabled={disabled}
          />
        )}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <Field label={field.label} hint={hint} required={required} error={error}>
        {({ inputId, describedBy }) => (
          <Select
            id={inputId}
            invalid={Boolean(error)}
            aria-describedby={describedBy}
            disabled={disabled}
            {...register(name)}
          >
            <option value="">Select…</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  if (field.type === 'textarea') {
    return (
      <Field
        label={field.label}
        hint={hint}
        required={required}
        error={error}
        className="sm:col-span-2"
      >
        {({ inputId, describedBy }) => (
          <Textarea
            id={inputId}
            invalid={Boolean(error)}
            aria-describedby={describedBy}
            disabled={disabled}
            {...register(name)}
          />
        )}
      </Field>
    );
  }

  // `datetime` is local wall-clock time here; `toFieldValues` converts it
  // to the ISO instant the server stores.
  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'datetime'
          ? 'datetime-local'
          : 'text';

  return (
    <Field label={field.label} hint={hint} required={required} error={error}>
      {({ inputId, describedBy }) => (
        <Input
          id={inputId}
          type={inputType}
          invalid={Boolean(error)}
          aria-describedby={describedBy}
          disabled={disabled}
          {...register(name)}
        />
      )}
    </Field>
  );
}

/**
 * A `multi_select` Field as one checkbox per configured option, its value the
 * ticked options as a string[]. `Field` wraps a single labelled input, so
 * this is the group equivalent: a fieldset whose legend is the label.
 */
function MultiSelectControl({
  field,
  value,
  onChange,
  onBlur,
  required,
  error,
  hint,
  disabled,
}: {
  field: FieldDefinition;
  value: FormFieldValue | undefined;
  onChange: (next: string[]) => void;
  onBlur: () => void;
  required: boolean;
  error: string | undefined;
  hint: string | undefined;
  disabled: boolean;
}) {
  const messageId = useId();
  const selected = Array.isArray(value) ? value : [];
  const configured = field.options ?? [];
  // A stored value no longer among the options stays listed, so it can be
  // seen and unticked rather than kept invisibly (the server refuses it).
  const options = [...configured, ...selected.filter((item) => !configured.includes(item))];
  const message = error ?? hint ?? (options.length === 0 ? 'No options configured' : undefined);

  return (
    <fieldset
      className="flex flex-col gap-1.5 sm:col-span-2"
      aria-describedby={message ? messageId : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium text-ink">
        {field.label}
        {required ? (
          <span className="ml-0.5 text-status-lost" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => (
          <Checkbox
            key={option}
            label={option}
            disabled={disabled}
            checked={selected.includes(option)}
            onBlur={onBlur}
            onChange={(event) =>
              // In option order, so the stored list doesn't depend on click order.
              onChange(
                options.filter((item) =>
                  item === option ? event.target.checked : selected.includes(item),
                ),
              )
            }
          />
        ))}
      </div>
      {message ? (
        <p id={messageId} className={error ? 'text-sm text-status-lost' : 'text-sm text-ink-soft'}>
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
