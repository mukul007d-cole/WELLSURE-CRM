/**
 * The campaign body: a closed-vocabulary document, rendered to HTML by the
 * server.
 *
 * The parse/validate/escape/render core is generic and lives in
 * `@falcon/validation`'s `document.ts` — this module re-exports it under the
 * campaign-era names (`CampaignDocument` etc.) so every existing caller keeps
 * working unchanged, and adds the one thing genuinely specific to campaigns:
 * mail-merge `{{token}}` interpolation against send-time variables.
 */

import {
  blockTypes,
  escapeHtml,
  markTypes,
  maxBlocks,
  maxSpansPerBlock,
  parseDocument as parseStructuredDocument,
  renderDocument as renderStructuredDocument,
  StructuredDocumentError,
  type BlockType,
  type DocumentBlock,
  type MarkType,
  type StructuredDocument,
  type TextSpan,
} from '@falcon/validation';

export { blockTypes, escapeHtml, markTypes, maxBlocks, maxSpansPerBlock };
export type { BlockType, DocumentBlock, MarkType, TextSpan };

export type CampaignDocument = StructuredDocument;
export const CampaignDocumentError = StructuredDocumentError;
export const parseDocument = parseStructuredDocument;

export function documentTokens(document: CampaignDocument): string[] {
  const found = new Set<string>();
  const scan = (spans: readonly TextSpan[]) => {
    for (const span of spans)
      for (const match of span.text.matchAll(tokenPattern)) found.add(match[1]!);
  };
  for (const block of document.blocks) {
    scan(block.spans ?? []);
    for (const item of block.items ?? []) scan(item);
  }
  return [...found];
}

const tokenPattern = /\{\{\s*([a-zA-Z0-9_:-]+)\s*\}\}/g;

/** Unknown tokens are left as written; a missing value renders as empty. */
export function interpolate(text: string, variables: ReadonlyMap<string, string>): string {
  return text.replaceAll(tokenPattern, (match, token: string) =>
    variables.has(token) ? variables.get(token)! : match,
  );
}

/**
 * Render to HTML, interpolating `{{token}}` against the supplied values.
 *
 * Interpolation happens on the raw text and the result is escaped as a whole,
 * so a value carrying markup is inert and a value carrying another token is not
 * re-expanded.
 */
export function renderDocument(
  document: CampaignDocument,
  variables: ReadonlyMap<string, string>,
): string {
  const interpolated: CampaignDocument = {
    blocks: document.blocks.map((block) => interpolateBlock(block, variables)),
  };
  return renderStructuredDocument(interpolated);
}

function interpolateBlock(
  block: DocumentBlock,
  variables: ReadonlyMap<string, string>,
): DocumentBlock {
  if (block.type === 'bullet_list' || block.type === 'numbered_list') {
    return {
      ...block,
      items: (block.items ?? []).map((spans) => interpolateSpans(spans, variables)),
    };
  }
  return { ...block, spans: interpolateSpans(block.spans ?? [], variables) };
}

function interpolateSpans(
  spans: readonly TextSpan[],
  variables: ReadonlyMap<string, string>,
): TextSpan[] {
  return spans.map((span) => ({ ...span, text: interpolate(span.text, variables) }));
}
