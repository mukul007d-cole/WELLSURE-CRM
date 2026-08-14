import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Stepper } from '../../components/ui/Stepper';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { adminApi, configApi, importApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { ImportAnalysis, ImportRunResult } from '../../types/domain';
import { ColumnMappingStep } from './ColumnMappingStep';
import { PreviewStep } from './PreviewStep';
import { ResultStep } from './ResultStep';
import { UploadStep } from './UploadStep';
import {
  buildTargetOptions,
  importSteps,
  initialColumnTargets,
  mappedCount,
  mappingProblems,
  toMapping,
  type ImportStepId,
  type MappingDraft,
} from './import-state';

const emptyDraft: MappingDraft = {
  journeyId: '',
  statusId: '',
  assignmentType: '',
  assignmentUserId: '',
  columns: {},
  matchKeys: [],
};

/**
 * Upload → map → preview → confirm → commit.
 *
 * The file never leaves the browser between steps: the server stores nothing,
 * so each request re-sends it. `contentHash` from the preview is echoed on
 * commit, and the server refuses a commit whose bytes differ — which is what
 * makes "you are committing what you previewed" true rather than assumed.
 */
export function ImportPage() {
  const [step, setStep] = useState<ImportStepId>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [draft, setDraft] = useState<MappingDraft>(emptyDraft);
  const [preview, setPreview] = useState<ImportRunResult | null>(null);
  const [outcome, setOutcome] = useState<ImportRunResult | null>(null);
  const [stopOnError, setStopOnError] = useState(false);

  const journeys = useQuery({ queryKey: qk.journeys(), queryFn: configApi.journeys });
  const fields = useQuery({ queryKey: qk.fields(), queryFn: configApi.fields });
  const statuses = useQuery({
    queryKey: qk.journeyStatuses(draft.journeyId),
    queryFn: () => configApi.statuses(draft.journeyId),
    enabled: draft.journeyId !== '',
  });
  const assignmentTypes = useQuery({
    queryKey: ['import', 'assignment-types', draft.journeyId],
    queryFn: () => configApi.assignmentTypes(draft.journeyId),
    enabled: draft.journeyId !== '',
  });
  const users = useQuery({
    queryKey: qk.directoryUsers(),
    queryFn: () => adminApi.users({ page: 1, pageSize: 100, active: true }),
  });

  const analyze = useMutation({
    mutationFn: (next: File) => importApi.analyze(next),
    onSuccess: (result, next) => {
      setFile(next);
      setAnalysis(result);
      setDraft({ ...emptyDraft, columns: initialColumnTargets(result) });
      setStep('map');
    },
  });

  const runPreview = useMutation({
    mutationFn: () =>
      importApi.run('preview', { file: file!, mapping: toMapping(draft), stopOnError }),
    onSuccess: (result) => {
      setPreview(result);
      setStep('preview');
    },
  });

  const runCommit = useMutation({
    mutationFn: () =>
      importApi.run('commit', {
        file: file!,
        mapping: toMapping(draft),
        stopOnError,
        contentHash: preview!.contentHash,
      }),
    onSuccess: (result) => {
      setOutcome(result);
      setStep('result');
    },
  });

  const options = useMemo(
    () =>
      buildTargetOptions({
        fields: (fields.data ?? []).map((field) => ({ id: field.id, label: field.label })),
        assignmentTypes: assignmentTypes.data ?? [],
      }),
    [fields.data, assignmentTypes.data],
  );
  const fieldChoices = useMemo(
    () => (fields.data ?? []).map((field) => ({ id: field.id, label: field.label })),
    [fields.data],
  );

  const problems = analysis === null ? [] : mappingProblems(draft);
  const completed: ImportStepId[] = [];
  if (analysis !== null) completed.push('upload');
  if (preview !== null) completed.push('map');
  if (outcome !== null) completed.push('preview');

  const startOver = () => {
    setStep('upload');
    setFile(null);
    setAnalysis(null);
    setDraft(emptyDraft);
    setPreview(null);
    setOutcome(null);
    analyze.reset();
    runPreview.reset();
    runCommit.reset();
  };

  const stepDetail =
    analysis === null
      ? undefined
      : `${analysis.fileName} · ${analysis.rowCount} ${analysis.rowCount === 1 ? 'row' : 'rows'}`;

  return (
    <PageBody>
      <PageHeader
        title="Import leads"
        description="Bring leads in from a CSV. Nothing is created until you confirm a preview."
      />

      <Card>
        <CardBody className="py-3">
          <Stepper
            steps={importSteps.map((entry) => ({
              ...entry,
              ...(entry.id === step && stepDetail ? { detail: stepDetail } : {}),
            }))}
            current={step}
            completed={completed}
            label="Import progress"
            {...(outcome === null
              ? {
                  onSelect: (id: ImportStepId) => {
                    // Backwards only, and never back into a finished run.
                    if (id === 'upload' || (id === 'map' && analysis !== null)) setStep(id);
                  },
                }
              : {})}
          />
        </CardBody>
      </Card>

      {step === 'upload' ? (
        <UploadStep
          onFile={(next) => analyze.mutate(next)}
          isPending={analyze.isPending}
          error={analyze.error ? friendlyErrorMessage(analyze.error) : null}
        />
      ) : null}

      {step === 'map' && analysis !== null ? (
        <>
          <ColumnMappingStep
            analysis={analysis}
            draft={draft}
            options={options}
            journeys={journeys.data ?? []}
            statuses={statuses.data ?? []}
            users={(users.data?.items ?? []).map((user) => ({ id: user.id, name: user.name }))}
            fields={fieldChoices}
            problems={problems}
            onChange={setDraft}
          />
          {runPreview.error ? (
            <Banner tone="error">{friendlyErrorMessage(runPreview.error)}</Banner>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox
              label="Import nothing unless every row is valid"
              checked={stopOnError}
              onChange={(event) => setStopOnError(event.target.checked)}
            />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={startOver}>
                Start over
              </Button>
              <Button
                type="button"
                onClick={() => runPreview.mutate()}
                loading={runPreview.isPending}
                disabled={problems.length > 0 || mappedCount(draft.columns) === 0}
              >
                Preview import
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {step === 'preview' && preview !== null ? (
        <>
          <PreviewStep result={preview} />
          {runCommit.error ? (
            <Banner tone="error">{friendlyErrorMessage(runCommit.error)}</Banner>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              Nothing has been created yet. Committing creates{' '}
              <span className="font-medium text-ink">{preview.createdCount}</span>{' '}
              {preview.createdCount === 1 ? 'lead' : 'leads'}.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep('map')}>
                Back to mapping
              </Button>
              <Button
                type="button"
                onClick={() => runCommit.mutate()}
                loading={runCommit.isPending}
                disabled={preview.createdCount === 0}
              >
                {runCommit.isPending
                  ? `Creating ${preview.createdCount}…`
                  : `Create ${preview.createdCount} ${preview.createdCount === 1 ? 'lead' : 'leads'}`}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {step === 'result' && outcome !== null ? (
        <ResultStep result={outcome} onStartOver={startOver} />
      ) : null}
    </PageBody>
  );
}
