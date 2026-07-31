import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { configApi, sellersApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { DynamicFieldControl } from './DynamicFieldControl';
import { defaultFieldValues, leadFormSchema, toFieldValues } from './schema';
import type { LeadFormValues } from './schema';

export function LeadFormPage() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const isEditMode = Boolean(sellerId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const journeysQuery = useQuery({ queryKey: ['journeys'], queryFn: configApi.journeys });
  const fieldsQuery = useQuery({ queryKey: ['fields'], queryFn: configApi.fields });
  const sellerQuery = useQuery({
    queryKey: ['seller', sellerId],
    queryFn: () => sellersApi.detail(sellerId as string),
    enabled: isEditMode,
  });

  const fields = fieldsQuery.data ?? [];
  const existingProcess = sellerQuery.data?.processInstances[0];

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    values: useMemo(
      () => ({
        name: sellerQuery.data?.name ?? '',
        phone: sellerQuery.data?.phone ?? '',
        email: sellerQuery.data?.email ?? '',
        journeyId: existingProcess?.journeyId ?? '',
        statusId: existingProcess?.currentStatus.id ?? '',
        fields: defaultFieldValues(fields, sellerQuery.data?.fieldValues),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [sellerQuery.data, fields.length],
    ),
  });

  const selectedJourneyId = watch('journeyId');
  const statusesQuery = useQuery({
    queryKey: ['statuses', selectedJourneyId],
    queryFn: () => configApi.statuses(selectedJourneyId),
    enabled: Boolean(selectedJourneyId),
  });

  async function onSubmit(values: LeadFormValues) {
    setSubmitError(null);
    try {
      if (isEditMode && sellerId && existingProcess) {
        await sellersApi.edit(sellerId, {
          leadId: sellerId,
          processInstanceId: existingProcess.processInstanceId,
          journeyId: values.journeyId,
          name: values.name,
          phone: values.phone || null,
          email: values.email || null,
          fieldValues: toFieldValues(fields, values.fields),
          statusId: values.statusId || undefined,
        });
        await queryClient.invalidateQueries({ queryKey: ['seller', sellerId] });
        void navigate(`/sellers/${sellerId}`);
      } else {
        if (!user) return;
        const created = await sellersApi.create({
          journeyId: values.journeyId,
          statusId: values.statusId || undefined,
          name: values.name,
          phone: values.phone || null,
          email: values.email || null,
          fieldValues: toFieldValues(fields, values.fields),
          assignments: [{ assignmentType: 'owner', userId: user.id }],
        });
        await queryClient.invalidateQueries({ queryKey: ['sellers'] });
        void navigate(`/sellers/${created.id}`);
      }
    } catch (error) {
      setSubmitError(friendlyErrorMessage(error));
    }
  }

  const loadingInitialData = isEditMode && sellerQuery.isPending;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <Link
          to={isEditMode ? `/sellers/${sellerId}` : '/sellers'}
          className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M8.5 3 4 7l4.5 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isEditMode ? 'Back to seller' : 'Back to sellers'}
        </Link>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          {isEditMode ? 'Edit seller' : 'New seller'}
        </h2>
      </div>

      {loadingInitialData ? (
        <Card className="flex flex-col gap-4 p-6">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </Card>
      ) : (
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="flex flex-col gap-6"
        >
          {submitError ? <Banner tone="error">{submitError}</Banner> : null}

          <Card className="flex flex-col gap-4 p-6">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Core details
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" error={errors.name?.message} required className="sm:col-span-2">
                {({ inputId, describedBy }) => (
                  <Input
                    id={inputId}
                    invalid={Boolean(errors.name)}
                    aria-describedby={describedBy}
                    {...register('name')}
                  />
                )}
              </Field>
              <Field label="Phone">
                {({ inputId }) => <Input id={inputId} type="tel" {...register('phone')} />}
              </Field>
              <Field label="Email" error={errors.email?.message}>
                {({ inputId, describedBy }) => (
                  <Input
                    id={inputId}
                    type="email"
                    invalid={Boolean(errors.email)}
                    aria-describedby={describedBy}
                    {...register('email')}
                  />
                )}
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Journey &amp; status
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Journey" error={errors.journeyId?.message} required>
                {({ inputId, describedBy }) => (
                  <Select
                    id={inputId}
                    invalid={Boolean(errors.journeyId)}
                    aria-describedby={describedBy}
                    disabled={isEditMode}
                    {...register('journeyId')}
                  >
                    <option value="">Choose a journey…</option>
                    {journeysQuery.data?.map((journey) => (
                      <option key={journey.id} value={journey.id}>
                        {journey.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Status"
                hint={!selectedJourneyId ? 'Choose a journey first' : undefined}
              >
                {({ inputId }) => (
                  <Select id={inputId} disabled={!selectedJourneyId} {...register('statusId')}>
                    <option value="">
                      {isEditMode ? 'Keep current status' : 'Use journey default'}
                    </option>
                    {statusesQuery.data?.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Additional details
            </h3>
            {fieldsQuery.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields
                  .filter((field) => field.type !== 'json')
                  .map((field) => (
                    <DynamicFieldControl key={field.id} field={field} register={register} />
                  ))}
              </div>
            )}
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void navigate(isEditMode ? `/sellers/${sellerId}` : '/sellers')}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isEditMode ? 'Save changes' : 'Create seller'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
