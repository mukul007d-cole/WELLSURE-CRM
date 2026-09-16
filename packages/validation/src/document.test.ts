import { describe, expect, it } from 'vitest';

import { parseDocument, renderDocument, StructuredDocumentError } from './document.js';

describe('structured document', () => {
  it('accepts the documented blocks and marks, and escapes text on render', () => {
    const document = parseDocument({
      blocks: [
        { type: 'heading', spans: [{ text: 'Title' }] },
        {
          type: 'paragraph',
          spans: [
            { text: '<script>alert(1)</script>', marks: ['bold'] },
            { text: 'link', href: 'https://example.test' },
          ],
        },
        { type: 'bullet_list', items: [[{ text: 'one' }], [{ text: 'two' }]] },
      ],
    });
    const html = renderDocument(document);
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<a href="https://example.test">link</a>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
  });

  it('rejects an unknown block type, an unknown mark, and a disallowed link scheme', () => {
    expect(() => parseDocument({ blocks: [{ type: 'table', spans: [] }] })).toThrow(
      StructuredDocumentError,
    );
    expect(() =>
      parseDocument({ blocks: [{ type: 'paragraph', spans: [{ text: 'x', marks: ['strike'] }] }] }),
    ).toThrow(StructuredDocumentError);
    expect(() =>
      parseDocument({
        blocks: [{ type: 'paragraph', spans: [{ text: 'x', href: 'javascript:alert(1)' }] }],
      }),
    ).toThrow(StructuredDocumentError);
  });

  it('rejects a non-object body and a non-array blocks field', () => {
    expect(() => parseDocument(null)).toThrow(StructuredDocumentError);
    expect(() => parseDocument({ blocks: 'nope' })).toThrow(StructuredDocumentError);
  });
});
