import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { notificationsApi } from '../../lib/api-client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { usePageChrome } from '../../app/page-chrome';

const triggers = [
  ['field_edited', 'Field edited'],
  ['status_changed', 'Status changed'],
  ['lead_reassigned', 'Lead reassigned'],
  ['shared_lead_modified_by_non_owner', 'Shared lead modified'],
  ['lead_deactivated', 'Lead deactivated'],
] as const;
const resolvers = [
  ['assignment_holder', 'Assignment holder'],
  ['assignment_holder_manager', 'Holder’s manager'],
  ['previous_assignment_holder', 'Previous holder'],
  ['share_creator', 'Share creator'],
  ['active_shared_users_except_actor', 'All shared users except actor'],
  ['feature_permission_holders', 'Feature permission holders'],
] as const;

export function NotificationRulesPage() {
  usePageChrome('Notification rules', [['notification-rules']]);
  const client = useQueryClient(),
    rules = useQuery({ queryKey: ['notification-rules'], queryFn: notificationsApi.rules });
  const [key, setKey] = useState(''),
    [name, setName] = useState(''),
    [trigger, setTrigger] = useState('field_edited'),
    [resolver, setResolver] = useState('assignment_holder'),
    [parameter, setParameter] = useState('');
  const create = useMutation({
    mutationFn: () =>
      notificationsApi.createRule({
        key,
        name,
        triggerType: trigger,
        recipients: [
          {
            resolverType: resolver,
            parameters: resolver.includes('assignment')
              ? { assignmentType: parameter }
              : resolver === 'feature_permission_holders'
                ? { module: 'leads', action: parameter || 'view' }
                : {},
          },
        ],
      }),
    onSuccess: () => {
      setKey('');
      setName('');
      void client.invalidateQueries({ queryKey: ['notification-rules'] });
    },
  });
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-2xl font-bold">Notification rules</h2>
        <p className="text-sm text-ink-soft">
          Configure in-app recipients for Lead events. Renaming a Field section can stop
          section-scoped rules from matching.
        </p>
      </div>
      <Card className="p-5">
        <h3 className="font-semibold">New rule</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm" htmlFor="notification-rule-key">
            Key
            <Input
              id="notification-rule-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="synthetic_rule"
            />
          </label>
          <label className="text-sm" htmlFor="notification-rule-name">
            Name
            <Input
              id="notification-rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Trigger
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {triggers.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            Recipient resolver
            <Select value={resolver} onChange={(e) => setResolver(e.target.value)}>
              {resolvers.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm sm:col-span-2" htmlFor="notification-rule-parameter">
            Resolver parameter
            <Input
              id="notification-rule-parameter"
              value={parameter}
              onChange={(e) => setParameter(e.target.value)}
              placeholder="Configured assignment type or permission action"
            />
          </label>
        </div>
        <Button
          className="mt-4"
          disabled={!key || !name || create.isPending}
          onClick={() => create.mutate()}
        >
          Create rule
        </Button>
      </Card>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {rules.data?.items.map((rule) => (
            <li key={rule.id} className="p-4">
              <div className="flex justify-between">
                <span className="font-medium">{rule.name}</span>
                <span className="text-xs text-ink-soft">{rule.active ? 'Active' : 'Inactive'}</span>
              </div>
              <p className="text-xs text-ink-soft">
                {rule.triggerType} · {rule.recipients.map((r) => r.resolverType).join(', ')}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
