import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Eyebrow } from '../../components/ui/Heading';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { configApi, sellersApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { groupFieldsBySection } from '../../lib/field-sections';
import { qk } from '../../lib/query-keys';
import type { FieldDefinition } from '../../types/domain';
import { DynamicFieldControl } from './DynamicFieldControl';
import { defaultFieldValues, leadFormSchema, toFieldValues } from './schema';
import type { LeadFormValues } from './schema';
import { usePageChrome } from '../../app/page-chrome';

/**
 * A newly-created lead has no owner-type ambiguity to resolve — this
 * product's own bulk-import screen already calls the concept "owner", and a
 * Journey with no leads yet has never had *any* assignment type, so there is
 * nothing more canonical to fall back on than the name the rest of the app
 * already uses. Naming a genuinely different first type for a Journey is an
 * admin-shaped decision (bulk import's own free-text "Owner type" field
 * already covers it) — not something a day-to-day rep creating one seller
 * should ever be asked to invent.
 */
const defaultAssignmentType = 'owner';

export function LeadFormPage() {
  usePageChrome('Seller', []);
  const { sellerId } = useParams<{ sellerId: string }>();
  const isEditMode = Boolean(sellerId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const journeysQuery = useQuery({ queryKey: ['journeys'], queryFn: configApi.journeys });
  const fieldsQuery = useQuery({ queryKey: ['fields'], queryFn: configApi.fields });
  const sellerQuery = useQuery({
    queryKey: qk.sellerDetail(sellerId as string),
    queryFn: () =>
      sellersApi.detail(sellerId as string, {
        requestedFieldIds: (fieldsQuery.data ?? []).map((field) => field.id),
      }),
    // Waits on the Field catalogue to settle (succeed or fail) so the fetch
    // already names every Field id it wants back — otherwise the API hands
    // back no field values at all (its rule, not a bug) and every Additional
    // field reopens blank, looking like the earlier edit never saved. Gating
    // on success alone would hang the form forever for a viewer whose role
    // can't list Fields.
    enabled: isEditMode && !fieldsQuery.isPending,
  });

  const fields = fieldsQuery.data ?? [];
  const existingProcess = sellerQuery.data?.processInstances[0];
  // `json` fields have never had a control here; `api-only` ones are new —
  // hidden from every human-facing form, the same rule the server enforces
  // for the values themselves (there is no distinct "API caller" identity to
  // gate on server-side, so the human form simply never offers the control).
  const formFields = fields.filter(
    (field) => field.type !== 'json' && field.editMode !== 'api-only',
  );
  const formSections = groupFieldsBySection(formFields);
  const existingFieldValues = sellerQuery.data?.fieldValues;

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
        assignmentType: '',
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
  /**
   * Only needed when creating: an edit reuses the assignments the lead already
   * has rather than establishing a new one.
   */
  const assignmentTypesQuery = useQuery({
    queryKey: ['assignment-types', selectedJourneyId],
    queryFn: () => configApi.assignmentTypes(selectedJourneyId),
    enabled: Boolean(selectedJourneyId) && !isEditMode,
  });
  const activeStatuses = (statusesQuery.data ?? []).filter((status) => status.isActive);
  /**
   * Creating without an explicit statusId falls back to the Journey's
   * default-on-create Status. Offering that when no Status carries the flag is
   * a trap: the API rejects it with a bare validation_error that names nothing.
   */
  const hasDefaultStatus = activeStatuses.some((status) => status.isDefaultOnCreate);
  const journeyHasNoStatuses =
    Boolean(selectedJourneyId) && statusesQuery.isSuccess && activeStatuses.length === 0;
  const assignmentTypes = assignmentTypesQuery.data ?? [];
  /**
   * A Journey using exactly one assignment type (the overwhelmingly common
   * case — a single "owner" slot) or none yet has nothing to ask a rep to
   * decide: the new seller is assigned to them, under that one type or
   * `defaultAssignmentType` if the Journey has never had one. A Journey
   * that has genuinely used more than one type at once (e.g. "owner" and a
   * separate "referrer") keeps a real picker, because that is an actual
   * choice with more than one right answer — see `assignmentTypeToUse`.
   */
  const needsAssignmentChoice = assignmentTypes.length >= 2;
  const assignmentTypeToUse = needsAssignmentChoice
    ? undefined
    : (assignmentTypes[0] ?? defaultAssignmentType);

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
          // Feeds the authorization record-predicate. Omitting it sends an
          // empty array, which fails the scope check for any role narrower
          // than ORGANIZATION — a silent 403 on save.
          assignmentTypes: [...new Set(existingProcess.assignments.map((a) => a.assignmentType))],
        });
        await queryClient.invalidateQueries({ queryKey: qk.seller(sellerId) });
        void navigate(`/sellers/${sellerId}`);
      } else {
        if (!user) return;
        if (journeyHasNoStatuses) {
          setSubmitError(
            'This journey has no active statuses yet. Add one to the journey before creating sellers on it.',
          );
          return;
        }
        if (!hasDefaultStatus && !values.statusId) {
          setSubmitError('Choose a status — this journey has no default to fall back on.');
          return;
        }
        const assignmentType = assignmentTypeToUse ?? values.assignmentType?.trim();
        if (!assignmentType) {
          setSubmitError('Choose who this seller is assigned as before saving.');
          return;
        }
        const created = await sellersApi.create({
          journeyId: values.journeyId,
          statusId: values.statusId || undefined,
          name: values.name,
          phone: values.phone || null,
          email: values.email || null,
          fieldValues: toFieldValues(fields, values.fields),
          // Always the creator — a new seller belongs to whoever adds it.
          // `assignmentType` is still free text at the API (nothing here
          // makes "owner" a canonical enum value), just no longer a
          // decision this form asks a rep to make in the common case.
          assignments: [{ assignmentType, userId: user.id }],
        });
        await queryClient.invalidateQueries({ queryKey: ['sellers'] });
        void navigate(`/sellers/${created.lead.id}`);
      }
    } catch (error) {
      setSubmitError(saveErrorMessage(error, fields));
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
            <Eyebrow as="h3" className="font-display">
              Core details
            </Eyebrow>
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
            <Eyebrow as="h3" className="font-display">
              Journey &amp; status
            </Eyebrow>
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
                    {isEditMode ? (
                      <option value="">Keep current status</option>
                    ) : hasDefaultStatus ? (
                      <option value="">Use journey default</option>
                    ) : (
                      <option value="">Choose a status</option>
                    )}
                    {statusesQuery.data?.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {/*
                Create only. An edit keeps whatever assignments the lead
                already has, so there is nothing to choose.

                A new seller belongs to whoever creates it — no picker for
                the common case where this Journey has at most one
                assignment type in use, only a plain statement of what will
                happen. A picker only appears when the Journey has
                genuinely used more than one type at once (e.g. "owner" and
                a separate "referrer"), because that's a real choice with
                more than one right answer; a higher-level person (a TL,
                a manager) can still move a seller to someone else
                afterward from its own page — see `ReassignDialog`.
              */}
              {isEditMode ? null : needsAssignmentChoice ? (
                <Field
                  label="Assignment role"
                  required
                  hint="This journey uses more than one assignment role — choose which one applies to you."
                  {...(submitError && !watch('assignmentType')?.trim()
                    ? { error: 'Choose an assignment role' }
                    : {})}
                >
                  {({ inputId, describedBy }) => (
                    <Select
                      id={inputId}
                      aria-describedby={describedBy}
                      disabled={!selectedJourneyId}
                      {...register('assignmentType')}
                    >
                      <option value="">Choose an assignment role</option>
                      {assignmentTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <div className="flex flex-col justify-center gap-0.5">
                  <span className="text-sm font-medium text-ink">Owner</span>
                  <span className="text-xs text-ink-soft">This seller will belong to you.</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <Eyebrow as="h3" className="font-display">
              Additional details
            </Eyebrow>
            {fieldsQuery.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="flex flex-col gap-5">
                {formSections.map((section) => (
                  <div key={section.name}>
                    {/* Suppressed when there is only one group, same rule the
                        read-only Details tab uses — a lone heading over every
                        field is noise, not structure. */}
                    {formSections.length > 1 ? (
                      <Eyebrow as="h4" className="mb-3 border-b border-line-soft pb-1.5">
                        {section.name}
                      </Eyebrow>
                    ) : null}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {section.fields.map((field) => (
                        <DynamicFieldControl
                          key={field.id}
                          field={field}
                          register={register}
                          disabled={
                            field.editMode === 'calculated' ||
                            field.editMode === 'system' ||
                            (field.editMode === 'locked' &&
                              hasValue(existingFieldValues?.[field.id]))
                          }
                        />
                      ))}
                    </div>
                  </div>
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

/** Mirrors `validateFieldValues`'s own `isMissing` — a blank string is not a stored value. */
function hasValue(value: unknown): boolean {
  return (
    value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '')
  );
}

/**
 * `friendlyErrorMessage` already turns a lead mutation's `validation_error`
 * into its real reason (e.g. "Required field is missing.") instead of the
 * generic "some fields need a second look" every code shares. This form has
 * one thing that generic version doesn't: the Field catalogue, so a
 * `details.fieldId` can be resolved to the name on the label rather than
 * left as an id no one filling out the form would recognize.
 */
function saveErrorMessage(error: unknown, fields: FieldDefinition[]): string {
  if (error instanceof ApiError && error.code === 'validation_error' && error.reason) {
    const fieldId = typeof error.details?.fieldId === 'string' ? error.details.fieldId : undefined;
    const field = fieldId ? fields.find((row) => row.id === fieldId) : undefined;
    if (field) return `“${field.label}” — ${error.reason}.`;
  }
  return friendlyErrorMessage(error);
}
