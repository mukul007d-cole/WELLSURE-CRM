import type { UseFormRegister } from 'react-hook-form';
import type { FieldDefinition } from '../../types/domain';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import type { LeadFormValues } from './schema';

interface DynamicFieldControlProps {
  field: FieldDefinition;
  register: UseFormRegister<LeadFormValues>;
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

  if (field.type === 'select') {
    return (
      <Field label={field.label} hint={hint}>
        {({ inputId, describedBy }) => (
          <Select
            id={inputId}
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
      <Field label={field.label} hint={hint} className="sm:col-span-2">
        {({ inputId, describedBy }) => (
          <Textarea
            id={inputId}
            aria-describedby={describedBy}
            disabled={disabled}
            {...register(name)}
          />
        )}
      </Field>
    );
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';

  return (
    <Field label={field.label} hint={hint}>
      {({ inputId, describedBy }) => (
        <Input
          id={inputId}
          type={inputType}
          aria-describedby={describedBy}
          disabled={disabled}
          {...register(name)}
        />
      )}
    </Field>
  );
}
