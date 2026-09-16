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

export { nextAvailableKey, slugify } from './slug.js';

export {
  computeCalculatedValue,
  isCalculationConfig,
  parseCalculationConfig,
} from './calculation.js';
export type {
  ArithmeticCalculation,
  CalculationConfig,
  CalculationOperand,
  ParseCalculationResult,
  ReferenceableField,
  TemplateCalculation,
} from './calculation.js';

export {
  blockTypes,
  escapeHtml,
  markTypes,
  maxBlocks,
  maxSpansPerBlock,
  parseDocument,
  renderDocument,
  StructuredDocumentError,
} from './document.js';
export type {
  BlockType,
  DocumentBlock,
  MarkType,
  StructuredDocument,
  TextSpan,
} from './document.js';
