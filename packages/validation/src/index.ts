/** Foundation boundary for the Falcon validation workspace. */
export const workspaceName = '@falcon/validation' as const;

export {
  CsvError,
  columnFillRate,
  columnSamples,
  isCsvError,
  parseCsv,
  toCsv,
  toCsvCell,
  toCsvRow,
} from './csv.js';
export type { CsvErrorCode, CsvParseOptions, CsvRow, CsvTable } from './csv.js';
