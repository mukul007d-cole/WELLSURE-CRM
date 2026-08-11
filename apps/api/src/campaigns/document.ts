/**
 * The campaign body: a closed-vocabulary document, rendered to HTML by the
 * server.
 *
 * Nothing the client authors is stored as markup and nothing it authors is
 * re-emitted. The composer sends blocks and marks from the vocabulary below,
 * this module validates them, and `renderDocument` builds the HTML itself with
 * every text node escaped. That removes HTML sanitization from the problem
 * rather than mitigating it: a Lead whose name contains `<script>` interpolates
 * as inert text, because escaping happens after interpolation, on the text.
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
export interface CampaignDocument {
  blocks: DocumentBlock[];
}

export const maxBlocks = 200;
export const maxSpansPerBlock = 200;

export class CampaignDocumentError extends Error {}

const allowedHref = /^(https?:\/\/|mailto:)/i;

export function parseDocument(raw: unknown): CampaignDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new CampaignDocumentError('body must be a document object');
  const blocks = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) throw new CampaignDocumentError('body.blocks must be an array');
  if (blocks.length > maxBlocks) throw new CampaignDocumentError('body has too many blocks');
  return { blocks: blocks.map(parseBlock) };
}

function parseBlock(raw: unknown): DocumentBlock {
  if (typeof raw !== 'object' || raw === null)
    throw new CampaignDocumentError('block must be an object');
  const row = raw as Record<string, unknown>;
  const type = typeof row.type === 'string' ? row.type : '';
  if (!(blockTypes as readonly string[]).includes(type))
    throw new CampaignDocumentError('unknown block type');
  const blockType = type as BlockType;
  if (blockType === 'bullet_list' || blockType === 'numbered_list') {
    const items = row.items;
    if (!Array.isArray(items)) throw new CampaignDocumentError('list block requires items');
    if (items.length > maxSpansPerBlock) throw new CampaignDocumentError('list block too long');
    return { type: blockType, items: items.map(parseSpans) };
  }
  return { type: blockType, spans: parseSpans(row.spans) };
}

function parseSpans(raw: unknown): TextSpan[] {
  if (!Array.isArray(raw)) throw new CampaignDocumentError('block requires spans');
  if (raw.length > maxSpansPerBlock) throw new CampaignDocumentError('block has too many spans');
  return raw.map((entry) => {
    if (typeof entry !== 'object' || entry === null)
      throw new CampaignDocumentError('span must be an object');
    const row = entry as Record<string, unknown>;
    if (typeof row.text !== 'string') throw new CampaignDocumentError('span.text must be a string');
    const marks = row.marks === undefined ? [] : row.marks;
    if (!Array.isArray(marks)) throw new CampaignDocumentError('span.marks must be an array');
    for (const mark of marks)
      if (typeof mark !== 'string' || !(markTypes as readonly string[]).includes(mark))
        throw new CampaignDocumentError('unknown mark');
    const span: TextSpan = { text: row.text, marks: marks as MarkType[] };
    if (row.href !== undefined) {
      if (typeof row.href !== 'string' || !allowedHref.test(row.href))
        // javascript: and data: URLs are the obvious attack; an allow-list of
        // schemes is the only safe direction here.
        throw new CampaignDocumentError('link must be http(s) or mailto');
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
  return document.blocks.map((block) => renderBlock(block, variables)).join('\n');
}

function renderBlock(block: DocumentBlock, variables: ReadonlyMap<string, string>): string {
  if (block.type === 'bullet_list' || block.type === 'numbered_list') {
    const tag = block.type === 'bullet_list' ? 'ul' : 'ol';
    const items = (block.items ?? [])
      .map((spans) => `<li>${renderSpans(spans, variables)}</li>`)
      .join('');
    return `<${tag}>${items}</${tag}>`;
  }
  const tag = block.type === 'heading' ? 'h2' : 'p';
  return `<${tag}>${renderSpans(block.spans ?? [], variables)}</${tag}>`;
}

function renderSpans(spans: readonly TextSpan[], variables: ReadonlyMap<string, string>): string {
  return spans
    .map((span) => {
      let html = escapeHtml(interpolate(span.text, variables));
      for (const mark of span.marks ?? []) html = `<${markTags[mark]}>${html}</${markTags[mark]}>`;
      // The href is validated to an allow-listed scheme and escaped as an
      // attribute value.
      return span.href === undefined ? html : `<a href="${escapeHtml(span.href)}">${html}</a>`;
    })
    .join('');
}

const tokenPattern = /\{\{\s*([a-zA-Z0-9_:-]+)\s*\}\}/g;

/** Unknown tokens are left as written; a missing value renders as empty. */
export function interpolate(text: string, variables: ReadonlyMap<string, string>): string {
  return text.replaceAll(tokenPattern, (match, token: string) =>
    variables.has(token) ? variables.get(token)! : match,
  );
}

/** Every token the document references, for authoring-time validation. */
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
