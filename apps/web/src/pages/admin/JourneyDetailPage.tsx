import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { adminApi } from '../../lib/api-client';

export function JourneyDetailPage() {
  const { journeyId = '' } = useParams(); const qc = useQueryClient(); const [name, setName] = useState('');
  const journey = useQuery({ queryKey: ['admin', 'journey', journeyId], queryFn: () => adminApi.journey(journeyId) });
  const settings = useQuery({ queryKey: ['admin', 'journey-fields', journeyId], queryFn: () => adminApi.journeyFields(journeyId) });
  const save = useMutation({ mutationFn: () => adminApi.editJourney(journeyId, { name: name || journey.data?.name || '' }), onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] }) });
  const reorder = useMutation({ mutationFn: () => adminApi.reorderStatuses(journeyId, [...(journey.data?.statuses ?? [])].reverse().map((x) => x.id)), onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] }) });
  return <div className="space-y-5 p-4 sm:p-6"><h2 className="font-display text-2xl font-bold">{journey.data?.name ?? 'Journey'}</h2><Card className="flex gap-3 p-4"><Field label="Journey name" className="flex-1">{({ inputId }) => <Input id={inputId} value={name} placeholder={journey.data?.name} onChange={(e) => setName(e.target.value)} />}</Field><Button className="self-end" onClick={() => save.mutate()}>Save</Button></Card><Card className="p-4"><div className="flex justify-between"><h3 className="font-display text-lg font-semibold">Statuses</h3><Button variant="secondary" onClick={() => reorder.mutate()}>Reverse order</Button></div><ol className="mt-3 divide-y">{journey.data?.statuses?.map((status) => <li className="flex justify-between py-3" key={status.id}><span>{status.name}</span><span className="text-sm text-ink-soft">{status.outcomeType} · {status.behaviorType}</span></li>)}</ol></Card><Card className="p-4"><h3 className="font-display text-lg font-semibold">Attached Fields</h3><ul className="mt-3 divide-y">{settings.data?.map((setting) => <li className="flex justify-between py-3" key={setting.fieldId}><span>{setting.field.name}</span><span>{setting.requirement}</span></li>)}</ul></Card></div>;
}
