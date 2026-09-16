/**
 * Client side of the campaign body format.
 *
 * The generic parser/renderer moved to `lib/structured-document.ts` once the
 * Tools resource library needed the identical model with no campaign
 * reference at all — this file re-exports it so every existing import here
 * keeps working unchanged.
 */
export {
  documentFromElement,
  documentPreview,
  elementHtmlFromDocument,
  emptyDocument,
  escapeHtml,
} from '../../../lib/structured-document';
