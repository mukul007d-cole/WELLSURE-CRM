import type {
  CampaignBlock,
  CampaignDocument,
  CampaignMark,
  CampaignSpan,
} from '../../../types/domain';

/**
 * Client side of the campaign body format.
 *
 * The composer edits a `contentEditable` region — cheap, dependency-free, and
 * enough for bold/italic/underline and lists — but what it *saves* is this
 * closed-vocabulary document, produced by walking the DOM. The server renders
 * the HTML itself, so nothing the browser produced is ever stored or emailed
 * verbatim.
 */

const markForTag: Record<string, CampaignMark> = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  U: 'underline',
};

/** Walk an edited region into the stored document shape. */
export function documentFromElement(root: HTMLElement): CampaignDocument {
  const blocks: CampaignBlock[] = [];
  let pending: CampaignSpan[] = [];
  const flush = () => {
    if (pending.length > 0) {
      blocks.push({ type: 'paragraph', spans: pending });
      pending = [];
    }
  };

  /*
   * Iterating childNodes rather than children matters: typing into a
   * contentEditable region regularly leaves bare text nodes beside block
   * elements, and walking only elements silently dropped them.
   */
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      collectSpans(node, [], undefined, pending);
      continue;
    }
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (tag === 'UL' || tag === 'OL') {
      flush();
      blocks.push({
        type: tag === 'UL' ? 'bullet_list' : 'numbered_list',
        items: Array.from(element.querySelectorAll('li')).map((item) => spansOf(item)),
      });
      continue;
    }
    if (tag === 'P' || tag === 'DIV' || /^H[1-6]$/.test(tag)) {
      flush();
      const spans = spansOf(element);
      if (spans.length > 0)
        blocks.push({ type: /^H[1-6]$/.test(tag) ? 'heading' : 'paragraph', spans });
      continue;
    }
    // An inline element at the top level belongs to the running paragraph.
    collectSpans(element, [], undefined, pending);
  }
  flush();
  return { blocks };
}

function spansOf(element: Element): CampaignSpan[] {
  const spans: CampaignSpan[] = [];
  for (const child of Array.from(element.childNodes)) collectSpans(child, [], undefined, spans);
  return spans;
}

function collectSpans(
  node: Node,
  marks: CampaignMark[],
  href: string | undefined,
  out: CampaignSpan[],
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text === '') return;
    out.push({
      text,
      ...(marks.length ? { marks: [...new Set(marks)] } : {}),
      ...(href ? { href } : {}),
    });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;
  const mark = markForTag[element.tagName];
  const nextMarks = mark ? [...marks, mark] : marks;
  // Only absolute http(s)/mailto links survive; the server rejects the rest
  // anyway, and dropping them here keeps the editor honest.
  const nextHref =
    element.tagName === 'A' && /^(https?:\/\/|mailto:)/i.test(element.getAttribute('href') ?? '')
      ? (element.getAttribute('href') ?? undefined)
      : href;
  for (const child of Array.from(element.childNodes)) collectSpans(child, nextMarks, nextHref, out);
}

/** Render the stored document back into editable HTML. */
export function elementHtmlFromDocument(document: CampaignDocument): string {
  return document.blocks
    .map((block) => {
      if (block.type === 'bullet_list' || block.type === 'numbered_list') {
        const tag = block.type === 'bullet_list' ? 'ul' : 'ol';
        return `<${tag}>${(block.items ?? []).map((spans) => `<li>${spansHtml(spans)}</li>`).join('')}</${tag}>`;
      }
      const tag = block.type === 'heading' ? 'h2' : 'p';
      return `<${tag}>${spansHtml(block.spans ?? [])}</${tag}>`;
    })
    .join('');
}

function spansHtml(spans: readonly CampaignSpan[]): string {
  return (
    spans
      .map((span) => {
        let html = escapeHtml(span.text);
        for (const mark of span.marks ?? [])
          html =
            mark === 'bold'
              ? `<strong>${html}</strong>`
              : mark === 'italic'
                ? `<em>${html}</em>`
                : `<u>${html}</u>`;
        return span.href ? `<a href="${escapeHtml(span.href)}">${html}</a>` : html;
      })
      .join('') || '<br>'
  );
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function emptyDocument(): CampaignDocument {
  return { blocks: [{ type: 'paragraph', spans: [{ text: '' }] }] };
}

/** Plain text of a document, for a compact list preview. */
export function documentPreview(document: CampaignDocument): string {
  return document.blocks
    .flatMap((block) => [...(block.spans ?? []), ...(block.items ?? []).flat()])
    .map((span) => span.text)
    .join(' ')
    .trim();
}
