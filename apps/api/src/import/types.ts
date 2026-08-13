/**
 * The vocabulary of a bulk import.
 *
 * Every target below is either a Lead core column or an id of something the
 * admin configured. No Field, Status, Journey or assignment type is named by
 * string anywhere in this module — a mapping refers to configuration by id (or,
 * for a Status resolved per row, by the admin's own configured name), so an
 * organization that renames everything tomorrow imports exactly the same way.
 */

/** Where one source column's values go. `skip` is a real, explicit choice. */
export type ColumnTarget =
  | { kind: 'skip' }
  | { kind: 'core'; column: CoreColumn }
  | { kind: 'field'; fieldId: string }
  /** The cell holds a user's email address; it becomes an assignment of this type. */
  | { kind: 'assignment'; assignmentType: string }
  /** The cell holds a Status name or key within the chosen Journey. */
  | { kind: 'status' };

export type CoreColumn = 'name' | 'phone' | 'email';

/** One component of the duplicate match key. */
export type MatchKey = { kind: 'core'; column: CoreColumn } | { kind: 'field'; fieldId: string };

export interface ImportMapping {
  journeyId: string;
  /** The whole file's Status. Omitted means the Journey's default-on-create. */
  statusId?: string | undefined;
  /** Assignments applied to every row, alongside any per-row assignment columns. */
  assignments: readonly { assignmentType: string; userId: string }[];
  /** One entry per header column, keyed by the column's name. All of them. */
  columns: Readonly<Record<string, ColumnTarget>>;
  /** Empty means duplicate matching is off and every row creates. */
  matchKeys: readonly MatchKey[];
}

export type RowOutcomeKind = 'created' | 'skipped_duplicate' | 'rejected';

export type RowOutcome =
  | { rowNumber: number; outcome: 'created'; leadId: string; processInstanceId: string }
  | {
      rowNumber: number;
      outcome: 'skipped_duplicate';
      /**
       * Present only when the matched lead is inside the importer's own record
       * scope. Matching runs organization-wide — otherwise an importer would
       * create real duplicates of records they cannot see — so a match outside
       * their scope is reported as a match without disclosing which record.
       */
      matchedLeadId: string | null;
      matchedLeadName: string | null;
    }
  | { rowNumber: number; outcome: 'rejected'; code: string; reason: string };

export interface ImportCounts {
  rowCount: number;
  createdCount: number;
  skippedCount: number;
  rejectedCount: number;
}

export interface ImportRunResult extends ImportCounts {
  mode: 'preview' | 'commit';
  /**
   * Whether anything was kept. False for every preview, and false for a commit
   * run with `stopOnError` that hit a rejection — in which case the caller still
   * receives the complete row-by-row report, and nothing was written.
   */
  committed: boolean;
  /** The `ImportJob` id — only on a run that committed; a preview's is rolled back. */
  jobId: string | null;
  fileName: string;
  /** `sha256:<hex>` of the bytes this run read. Echoed back on commit. */
  contentHash: string;
  rows: readonly RowOutcome[];
}

/** One source column, as the mapping UI sees it before anything is mapped. */
export interface AnalyzedColumn {
  index: number;
  name: string;
  samples: readonly string[];
  /** 0–1. Drives the mapping UI's fill meter. */
  fillRate: number;
}

export interface ImportAnalysis {
  fileName: string;
  contentHash: string;
  rowCount: number;
  columns: readonly AnalyzedColumn[];
  /** Records whose cell count differs from the header's. Reported, not fatal. */
  raggedRowNumbers: readonly number[];
}
