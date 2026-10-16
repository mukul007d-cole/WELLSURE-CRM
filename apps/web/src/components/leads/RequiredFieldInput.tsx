import { useId } from 'react';
import { Checkbox } from '../ui/Checkbox';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import type { FieldDefinition } from '../../types/domain';
import type { FieldDraft } from './field-drafts';

/**
 * One required Field, rendered from its definition. Deliberately plainer
 * than the lead form's `DynamicFieldControl` (which is bound to
 * react-hook-form): the dialog only ever shows a handful of empty fields.
 */
export function RequiredFieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: FieldDefinition;
  value: FieldDraft;
  onChange: (next: FieldDraft) => void;
  error?: string | undefined;
}) {
  const groupId = useId();

  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={groupId}
        label={field.label}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (field.type === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset
        className="flex flex-col gap-1.5"
        aria-describedby={error ? `${groupId}-error` : undefined}
      >
        <legend className="text-sm font-medium text-ink">
          {field.label}
          <span className="ml-0.5 text-status-lost" aria-hidden="true">
            *
          </span>
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(field.options ?? []).map((option) => (
            <Checkbox
              key={option}
              id={`${groupId}-${option}`}
              label={option}
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
            />
          ))}
        </div>
        {error ? (
          <p id={`${groupId}-error`} className="text-sm text-status-lost">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }

  const text = typeof value === 'string' ? value : '';

  return (
    <Field label={field.label} required error={error}>
      {({ inputId, describedBy }) =>
        field.type === 'select' ? (
          <Select
            id={inputId}
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">Select…</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : field.type === 'textarea' ? (
          <Textarea
            id={inputId}
            rows={2}
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            id={inputId}
            type={inputType(field.type)}
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Field>
  );
}

function inputType(type: FieldDefinition['type']): string {
  switch (type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime-local';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    default:
      return 'text';
  }
}
