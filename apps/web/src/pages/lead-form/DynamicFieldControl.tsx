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
}

export function DynamicFieldControl({ field, register }: DynamicFieldControlProps) {
  const name = `fields.${field.key}` as const;

  if (field.type === 'boolean') {
    return <Checkbox label={field.label} id={name} {...register(name)} />;
  }

  if (field.type === 'select') {
    return (
      <Field label={field.label}>
        {({ inputId }) => (
          <Select id={inputId} {...register(name)}>
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
      <Field label={field.label} className="sm:col-span-2">
        {({ inputId }) => <Textarea id={inputId} {...register(name)} />}
      </Field>
    );
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';

  return (
    <Field label={field.label}>
      {({ inputId }) => <Input id={inputId} type={inputType} {...register(name)} />}
    </Field>
  );
}
