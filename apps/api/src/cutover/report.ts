/**
 * What a cutover run did, or — in a dry run — would do. Written as JSON (for
 * tooling) and Markdown (for the people signing off). Holds counts, keys and
 * external ids; never field values beyond the short samples an operator needs
 * to fix a mapping, and never an excluded column.
 */
export interface CutoverReport {
  mode: 'dry-run' | 'commit';
  startedAt: string;
  finishedAt?: string;
  organizationId: string;
  configuration: {
    created: Record<string, number>;
    updated: Record<string, number>;
    notes: string[];
  };
  users: {
    source: number;
    created: number;
    existing: number;
    inactive: number;
    placeholders: Array<{ name: string; email: string; ownedRecords: number }>;
    unknownRoles: Array<{ email: string; roleName: string }>;
    ambiguousNames: string[];
    unresolvedMembers: Array<{ journey: string; name: string }>;
    unresolvedAutoAssign: Array<{ journey: string; status: string; name: string }>;
  };
  files: FileReport[];
  merges: {
    crossJourneyLeads: number;
    conflicts: Array<{ externalRefs: string[]; field: string; kept: string; dropped: string[] }>;
    review: Array<{ reason: string; externalRefs: string[] }>;
  };
  totals: {
    source: number;
    leadsCreated: number;
    processInstancesCreated: number;
    alreadyMigrated: number;
    rejected: number;
  };
}

export interface FileReport {
  journey: string;
  path: string;
  source: number;
  created: number;
  mergedIntoOtherJourney: number;
  alreadyMigrated: number;
  rejected: Array<{ externalId: string; reason: string }>;
  statusCounts: Record<string, number>;
  unmappedStatuses: Record<string, number>;
  ignoredColumns: string[];
  droppedValues: Record<
    string,
    { count: number; reasons: Record<string, number>; samples: string[] }
  >;
  remarks: { lines: number; actorsResolved: number };
  followUps: { created: number; skippedClosed: number };
  namesDerived: number;
  previousOwners: { assigned: number; unresolved: number };
}

export function emptyReport(mode: CutoverReport['mode'], organizationId: string): CutoverReport {
  return {
    mode,
    startedAt: new Date().toISOString(),
    organizationId,
    configuration: { created: {}, updated: {}, notes: [] },
    users: {
      source: 0,
      created: 0,
      existing: 0,
      inactive: 0,
      placeholders: [],
      unknownRoles: [],
      ambiguousNames: [],
      unresolvedMembers: [],
      unresolvedAutoAssign: [],
    },
    files: [],
    merges: { crossJourneyLeads: 0, conflicts: [], review: [] },
    totals: {
      source: 0,
      leadsCreated: 0,
      processInstancesCreated: 0,
      alreadyMigrated: 0,
      rejected: 0,
    },
  };
}

export function countConfig(
  report: CutoverReport,
  kind: 'created' | 'updated',
  entity: string,
): void {
  report.configuration[kind][entity] = (report.configuration[kind][entity] ?? 0) + 1;
}

export function emptyFileReport(journey: string, path: string): FileReport {
  return {
    journey,
    path,
    source: 0,
    created: 0,
    mergedIntoOtherJourney: 0,
    alreadyMigrated: 0,
    rejected: [],
    statusCounts: {},
    unmappedStatuses: {},
    ignoredColumns: [],
    droppedValues: {},
    remarks: { lines: 0, actorsResolved: 0 },
    followUps: { created: 0, skippedClosed: 0 },
    namesDerived: 0,
    previousOwners: { assigned: 0, unresolved: 0 },
  };
}

export function noteDroppedValue(
  file: FileReport,
  field: string,
  reason: string,
  raw: string,
): void {
  const entry = (file.droppedValues[field] ??= { count: 0, reasons: {}, samples: [] });
  entry.count += 1;
  entry.reasons[reason] = (entry.reasons[reason] ?? 0) + 1;
  // Short, distinct samples only: enough to fix an option list, not a data dump.
  const sample = raw.slice(0, 40);
  if (entry.samples.length < 5 && !entry.samples.includes(sample)) entry.samples.push(sample);
}

export function renderMarkdown(report: CutoverReport): string {
  const lines: string[] = [];
  const t = report.totals;
  lines.push(`# Cutover report — ${report.mode}`, '');
  lines.push(
    `Started ${report.startedAt}${report.finishedAt ? `, finished ${report.finishedAt}` : ''}.`,
    '',
  );
  lines.push('## Totals', '');
  lines.push(
    '| Source records | Leads created | Process instances created | Already migrated | Rejected |',
  );
  lines.push('| ---: | ---: | ---: | ---: | ---: |');
  lines.push(
    `| ${t.source} | ${t.leadsCreated} | ${t.processInstancesCreated} | ${t.alreadyMigrated} | ${t.rejected} |`,
    '',
  );
  lines.push(
    `Reconciliation: source ${t.source} = instances ${t.processInstancesCreated} + already migrated ${t.alreadyMigrated} + rejected ${t.rejected} → ${t.source === t.processInstancesCreated + t.alreadyMigrated + t.rejected ? 'balanced' : '**NOT BALANCED**'}.`,
    '',
  );
  lines.push('## Configuration', '');
  for (const kind of ['created', 'updated'] as const) {
    const entries = Object.entries(report.configuration[kind]);
    lines.push(
      `- ${kind}: ${entries.length === 0 ? 'nothing' : entries.map(([k, v]) => `${k} ${v}`).join(', ')}`,
    );
  }
  for (const note of report.configuration.notes) lines.push(`- ${note}`);
  lines.push('', '## Users', '');
  const u = report.users;
  lines.push(
    `- ${u.source} in the users file: ${u.created} created, ${u.existing} already present, ${u.inactive} inactive.`,
  );
  lines.push(`- ${u.placeholders.length} inactive placeholder accounts for former owners:`);
  for (const p of u.placeholders) lines.push(`  - ${p.name} — ${p.ownedRecords} records`);
  if (u.unknownRoles.length)
    lines.push(
      `- Users whose role is not in the config: ${u.unknownRoles.map((r) => `${r.email} (${r.roleName})`).join(', ')}`,
    );
  if (u.ambiguousNames.length)
    lines.push(
      `- Names shared by several users (owner resolution picks the active one): ${u.ambiguousNames.join(', ')}`,
    );
  if (u.unresolvedMembers.length)
    lines.push(
      `- Journey members not found among users: ${u.unresolvedMembers.map((m) => `${m.name} (${m.journey})`).join(', ')}`,
    );
  if (u.unresolvedAutoAssign.length)
    lines.push(
      `- Auto-assign users not found or inactive: ${u.unresolvedAutoAssign.map((m) => `${m.name} (${m.journey} / ${m.status})`).join(', ')}`,
    );
  for (const file of report.files) {
    lines.push('', `## ${file.journey}`, '');
    lines.push(
      `- ${file.source} records: ${file.created} created, ${file.mergedIntoOtherJourney} merged into a lead from another journey, ${file.alreadyMigrated} already migrated, ${file.rejected.length} rejected.`,
    );
    lines.push(`- Names derived from email/phone for ${file.namesDerived} nameless records.`);
    lines.push(
      `- Remarks: ${file.remarks.lines} lines → comments (${file.remarks.actorsResolved} with a resolved author).`,
    );
    lines.push(
      `- Follow-ups: ${file.followUps.created} open follow-ups created, ${file.followUps.skippedClosed} skipped on closed statuses.`,
    );
    lines.push(
      `- Previous owners: ${file.previousOwners.assigned} recorded, ${file.previousOwners.unresolved} not resolvable.`,
    );
    lines.push(
      `- Status counts: ${Object.entries(file.statusCounts)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
    );
    if (Object.keys(file.unmappedStatuses).length)
      lines.push(
        `- **Unmapped statuses** (rows rejected): ${Object.entries(file.unmappedStatuses)
          .map(([k, v]) => `"${k}" ${v}`)
          .join(', ')}`,
      );
    if (file.ignoredColumns.length)
      lines.push(`- Columns not migrated: ${file.ignoredColumns.join(', ')}`);
    const dropped = Object.entries(file.droppedValues);
    if (dropped.length) {
      lines.push('- Values dropped (could not be stored as the field type):');
      for (const [field, d] of dropped)
        lines.push(
          `  - ${field}: ${d.count} (${Object.entries(d.reasons)
            .map(([r, c]) => `${r} ${c}`)
            .join(', ')}); e.g. ${d.samples.map((s) => `"${s}"`).join(', ')}`,
        );
    }
    if (file.rejected.length) {
      lines.push('- Rejected records:');
      for (const row of file.rejected.slice(0, 50))
        lines.push(`  - ${row.externalId}: ${row.reason}`);
      if (file.rejected.length > 50)
        lines.push(`  - … ${file.rejected.length - 50} more in the JSON report`);
    }
  }
  lines.push('', '## Duplicates (ADR-0027)', '');
  lines.push(
    `- ${report.merges.crossJourneyLeads} leads span several journeys after a safe merge.`,
  );
  lines.push(
    `- ${report.merges.conflicts.length} merged values differed between records (newest kept; listed in the JSON report).`,
  );
  const reasons = new Map<string, number>();
  for (const item of report.merges.review)
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  lines.push(
    `- Review queue: ${[...reasons].map(([r, c]) => `${c} × ${r}`).join(', ') || 'empty'} (records listed in the JSON report).`,
  );
  return `${lines.join('\n')}\n`;
}
