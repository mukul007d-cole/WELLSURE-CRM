import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { TabPanel, Tabs, useTabGroup, type TabItem } from '../../components/ui/Tabs';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { useUnsavedChanges } from '../../app/use-unsaved-changes';
import { JourneyFieldsTab } from './journey/JourneyFieldsTab';
import { JourneyMembersTab } from './journey/JourneyMembersTab';
import { JourneyRoutingTab } from './journey/JourneyRoutingTab';
import { JourneyStatusesTab } from './journey/JourneyStatusesTab';
import type { JourneyFieldRow } from './journey/queries';

type JourneyTab = 'statuses' | 'fields' | 'members' | 'routing';

/**
 * The Journey editor (Phase 24 D12): its name above, then one tab per
 * concern. Each tab owns its own drafts and mutations; this page owns the two
 * reads several tabs share. The open tab lives in `?tab=` so a link or a
 * reload lands back on it.
 */
export function JourneyDetailPage() {
  const { journeyId = '' } = useParams();
  usePageChrome('Journey', [
    ['admin', 'journey', journeyId],
    ['admin', 'journey-fields', journeyId],
    ['admin', 'journey-members', journeyId],
  ]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const groupId = useTabGroup();
  const [params, setParams] = useSearchParams();
  const [journeyName, setJourneyName] = useState('');
  const journey = useQuery({
    queryKey: ['admin', 'journey', journeyId],
    queryFn: () => adminApi.journey(journeyId),
  });
  const settings = useQuery({
    queryKey: ['admin', 'journey-fields', journeyId],
    queryFn: () => adminApi.journeyFields(journeyId),
  });
  const editJourney = useMutation({
    mutationFn: () =>
      adminApi.editJourney(journeyId, { name: journeyName || journey.data?.name || '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] }),
  });
  const error = journey.error ?? settings.error ?? editJourney.error;
  const statuses = journey.data?.statuses ?? [];
  // `requiredRoleIds` is on every row but not in the client's response type.
  const journeyFields: JourneyFieldRow[] = settings.data ?? [];
  useUnsavedChanges(Boolean(journeyName && journeyName !== journey.data?.name));

  const tabs: TabItem<JourneyTab>[] = [
    { id: 'statuses', label: 'Statuses', badge: journey.data ? statuses.length : undefined },
    { id: 'fields', label: 'Fields', badge: settings.data ? journeyFields.length : undefined },
    // Members are a personnel assignment, read on users:view (ADR-0026).
    ...(can('users', 'view') ? [{ id: 'members' as const, label: 'Members & access' }] : []),
    ...(can('lead_routing', 'view') ? [{ id: 'routing' as const, label: 'Routing' }] : []),
  ];
  const requested = params.get('tab');
  // An unknown or no-longer-permitted tab falls back rather than rendering nothing.
  const active = tabs.find((tab) => tab.id === requested)?.id ?? 'statuses';
  const selectTab = (tab: JourneyTab) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === 'statuses') next.delete('tab');
        else next.set('tab', tab);
        return next;
      },
      { replace: true },
    );

  return (
    <PageBody>
      <PageHeader
        title={journey.data?.name ?? 'Journey'}
        description="Manage this Journey's identity, Statuses, Fields, members and routing."
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {can('journeys_statuses', 'edit') ? (
        <Card className="flex gap-3 p-4">
          <Field label="Journey name" className="flex-1">
            {({ inputId }) => (
              <Input
                id={inputId}
                value={journeyName}
                placeholder={journey.data?.name}
                onChange={(event) => setJourneyName(event.target.value)}
              />
            )}
          </Field>
          <Button
            className="self-end"
            loading={editJourney.isPending}
            onClick={() => editJourney.mutate()}
          >
            Save Journey
          </Button>
        </Card>
      ) : null}
      <Tabs
        groupId={groupId}
        items={tabs}
        active={active}
        onChange={selectTab}
        label="Journey sections"
      />
      <TabPanel groupId={groupId} id={active}>
        {active === 'statuses' ? (
          <JourneyStatusesTab
            journeyId={journeyId}
            statuses={statuses}
            journeyFields={journeyFields}
          />
        ) : active === 'fields' ? (
          <JourneyFieldsTab journeyId={journeyId} statuses={statuses} settings={journeyFields} />
        ) : active === 'members' ? (
          <JourneyMembersTab journeyId={journeyId} />
        ) : (
          <JourneyRoutingTab
            journeyId={journeyId}
            statuses={statuses}
            assignmentTypeSuggestions={journey.data?.assignmentTypes ?? []}
          />
        )}
      </TabPanel>
    </PageBody>
  );
}
