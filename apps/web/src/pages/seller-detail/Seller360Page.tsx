import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { configApi, sellersApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { formatFieldValue } from '../../lib/format';
import { Banner } from '../../components/ui/Banner';
import { ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/StatusPill';

export function Seller360Page() {
  const { sellerId } = useParams<{ sellerId: string }>();

  const fieldsQuery = useQuery({ queryKey: ['fields'], queryFn: configApi.fields });
  const sellerQuery = useQuery({
    queryKey: ['seller', sellerId],
    queryFn: () => sellersApi.detail(sellerId as string),
    enabled: Boolean(sellerId),
    retry: (count, error) =>
      error instanceof ApiError && error.status === 404 ? false : count < 1,
  });

  if (sellerQuery.isError) {
    const notFound = sellerQuery.error instanceof ApiError && sellerQuery.error.status === 404;
    return (
      <div className="p-6">
        {notFound ? (
          <EmptyState
            title="Seller not found"
            description="This seller doesn’t exist, or you don’t have access to it."
            action={<ButtonLink to="/sellers">Back to sellers</ButtonLink>}
          />
        ) : (
          <Banner tone="error">{friendlyErrorMessage(sellerQuery.error)}</Banner>
        )}
      </div>
    );
  }

  if (sellerQuery.isPending || !sellerQuery.data) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const seller = sellerQuery.data;
  const fields = fieldsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Link
        to="/sellers"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
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
        Back to sellers
      </Link>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <RingAvatar name={seller.name} size={56} />
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">{seller.name}</h2>
            <p className="text-sm text-ink-soft">
              {seller.phone || '—'} {seller.email ? `· ${seller.email}` : ''}
            </p>
          </div>
        </div>
        <ButtonLink
          to={`/sellers/${seller.id}/edit`}
          variant="secondary"
          className="w-full sm:w-auto"
        >
          Edit seller
        </ButtonLink>
      </div>

      <Card className="p-5">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Journeys
        </h3>
        {seller.processInstances.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            You don’t have visibility into this seller’s journeys.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {seller.processInstances.map((process) => (
              <li
                key={process.processInstanceId}
                className="flex flex-col gap-2 rounded-control border border-line p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{process.journey.name}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {process.assignments.length > 0
                      ? process.assignments
                          .map(
                            (assignment) => `${assignment.userName} (${assignment.assignmentType})`,
                          )
                          .join(', ')
                      : 'No one assigned'}
                  </p>
                </div>
                <StatusPill
                  name={process.currentStatus.name}
                  outcomeType={process.currentStatus.outcomeType}
                  behaviorType={process.currentStatus.behaviorType}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Details
        </h3>
        {fieldsQuery.isPending ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {fields
              .filter((field) => field.key in seller.fieldValues)
              .map((field) => (
                <div key={field.id}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                    {field.label}
                  </dt>
                  <dd className="mt-1 text-sm text-ink">
                    {formatFieldValue(field, seller.fieldValues[field.key])}
                  </dd>
                </div>
              ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
