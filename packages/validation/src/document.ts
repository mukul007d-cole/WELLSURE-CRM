/**
 * A closed-vocabulary structured document, rendered to HTML by the server.
 *
 * Nothing the client authors is stored as markup and nothing it authors is
 * re-emitted. A caller sends blocks and marks from the vocabulary below, this
 * module validates them, and `renderDocument` builds the HTML itself with
 * every text node escaped. That removes HTML sanitization from the problem
 * rather than mitigating it: a value containing `<script>` interpolates as
 * inert text, because escaping happens after interpolation, on the text.
 *
 * Originally built for the campaign composer (`apps/api/src/campaigns/document.ts`,
 * which re-exports everything here and layers mail-merge interpolation on top);
 * relocated here once a second, unrelated caller (the Tools resource library's
 * usage-instructions field) needed the identical model with no interpolation
 * layer at all, rather than becoming a third rich-text mechanism.
 */

export const blockTypes = ['paragraph', 'heading', 'bullet_list', 'numbered_list'] as const;
export const markTypes = ['bold', 'italic', 'underline'] as const;

export type BlockType = (typeof blockTypes)[number];
export type MarkType = (typeof markTypes)[number];

export interface TextSpan {
  text: string;
  marks?: MarkType[];
  /** Absolute http(s) or mailto link; any other scheme is rejected. */
  href?: string;
}
export interface DocumentBlock {
  type: BlockType;
  /** One entry per list item; a single entry for paragraph and heading. */
  items?: TextSpan[][];
  spans?: TextSpan[];
}
export interface StructuredDocument {
  blocks: DocumentBlock[];
}

export const maxBlocks = 200;
export const maxSpansPerBlock = 200;

export class StructuredDocumentError extends Error {}

const allowedHref = /^(https?:\/\/|mailto:)/i;

export function parseDocument(raw: unknown): StructuredDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new StructuredDocumentError('body must be a document object');
  const blocks = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) throw new StructuredDocumentError('body.blocks must be an array');
  if (blocks.length > maxBlocks) throw new StructuredDocumentError('body has too many blocks');
  return { blocks: blocks.map(parseBlock) };
}

function parseBlock(raw: unknown): DocumentBlock {
  if (typeof raw !== 'object' || raw === null)
    throw new StructuredDocumentError('block must be an object');
  const row = raw as Record<string, unknown>;
  const type = typeof row.type === 'string' ? row.type : '';
  if (!(blockTypes as readonly string[]).includes(type))
    throw new StructuredDocumentError('unknown block type');
  const blockType = type as BlockType;
  if (blockType === 'bullet_list' || blockType === 'numbered_list') {
    const items = row.items;
    if (!Array.isArray(items)) throw new StructuredDocumentError('list block requires items');
    if (items.length > maxSpansPerBlock) throw new StructuredDocumentError('list block too long');
    return { type: blockType, items: items.map(parseSpans) };
  }
  return { type: blockType, spans: parseSpans(row.spans) };
}

function parseSpans(raw: unknown): TextSpan[] {
  if (!Array.isArray(raw)) throw new StructuredDocumentError('block requires spans');
  if (raw.length > maxSpansPerBlock) throw new StructuredDocumentError('block has too many spans');
  return raw.map((entry) => {
    if (typeof entry !== 'object' || entry === null)
      throw new StructuredDocumentError('span must be an object');
    const row = entry as Record<string, unknown>;
    if (typeof row.text !== 'string')
      throw new StructuredDocumentError('span.text must be a string');
    const marks = row.marks === undefined ? [] : row.marks;
    if (!Array.isArray(marks)) throw new StructuredDocumentError('span.marks must be an array');
    for (const mark of marks)
      if (typeof mark !== 'string' || !(markTypes as readonly string[]).includes(mark))
        throw new StructuredDocumentError('unknown mark');
    const span: TextSpan = { text: row.text, marks: marks as MarkType[] };
    if (row.href !== undefined) {
      if (typeof row.href !== 'string' || !allowedHref.test(row.href))
        // javascript: and data: URLs are the obvious attack; an allow-list of
        // schemes is the only safe direction here.
        throw new StructuredDocumentError('link must be http(s) or mailto');
      span.href = row.href;
    }
    return span;
  });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const markTags: Record<MarkType, string> = { bold: 'strong', italic: 'em', underline: 'u' };

/** Render to HTML. Every text node is escaped; nothing the caller authored is emitted raw. */
export function renderDocument(document: StructuredDocument): string {
  return document.blocks.map((block) => renderBlock(block)).join('\n');
}

function renderBlock(block: DocumentBlock): string {
  if (block.type === 'bullet_list' || block.type === 'numbered_list') {
    const tag = block.type === 'bullet_list' ? 'ul' : 'ol';
    const items = (block.items ?? []).map((spans) => `<li>${renderSpans(spans)}</li>`).join('');
    return `<${tag}>${items}</${tag}>`;
  }
  const tag = block.type === 'heading' ? 'h2' : 'p';
  return `<${tag}>${renderSpans(block.spans ?? [])}</${tag}>`;
}

function renderSpans(spans: readonly TextSpan[]): string {
  return spans
    .map((span) => {
      let html = escapeHtml(span.text);
      for (const mark of span.marks ?? []) html = `<${markTags[mark]}>${html}</${markTags[mark]}>`;
      // The href is validated to an allow-listed scheme and escaped as an
      // attribute value.
      return span.href === undefined ? html : `<a href="${escapeHtml(span.href)}">${html}</a>`;
    })
    .join('');
}
