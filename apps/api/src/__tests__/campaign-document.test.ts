import { describe, expect, it } from 'vitest';

import {
  CampaignDocumentError,
  documentTokens,
  parseDocument,
  renderDocument,
  type CampaignDocument,
} from '../campaigns/document.js';
import { unauthorizedTokens, variablesFor } from '../campaigns/variables.js';

const paragraph = (text: string, extra: Record<string, unknown> = {}): CampaignDocument => ({
  blocks: [{ type: 'paragraph', spans: [{ text, ...extra }] }],
});
const noVariables = new Map<string, string>();

describe('campaign document vocabulary', () => {
  it('accepts the documented blocks and marks', () => {
    const document = parseDocument({
      blocks: [
        { type: 'heading', spans: [{ text: 'Title' }] },
        { type: 'paragraph', spans: [{ text: 'Hello', marks: ['bold', 'italic'] }] },
        { type: 'bullet_list', items: [[{ text: 'One' }], [{ text: 'Two' }]] },
      ],
    });
    expect(document.blocks).toHaveLength(3);
  });

  it('rejects anything outside the vocabulary', () => {
    expect(() => parseDocument({ blocks: [{ type: 'script', spans: [] }] })).toThrow(
      CampaignDocumentError,
    );
    expect(() =>
      parseDocument({ blocks: [{ type: 'paragraph', spans: [{ text: 'x', marks: ['blink'] }] }] }),
    ).toThrow(CampaignDocumentError);
    expect(() => parseDocument({ blocks: 'nope' })).toThrow(CampaignDocumentError);
    expect(() => parseDocument('not a document')).toThrow(CampaignDocumentError);
  });

  it('rejects a link scheme that is not http(s) or mailto', () => {
    // javascript: and data: URLs are the obvious attack on a stored link.
    for (const href of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4='])
      expect(() => parseDocument(paragraph('click', { href }))).toThrow(CampaignDocumentError);
    expect(() => parseDocument(paragraph('ok', { href: 'https://example.test' }))).not.toThrow();
  });
});

describe('campaign rendering', () => {
  it('escapes author text, so stored content cannot inject markup', () => {
    const html = renderDocument(parseDocument(paragraph('<script>alert(1)</script>')), noVariables);
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).not.toContain('<script>');
  });

  it('escapes interpolated recipient values', () => {
    // The reason escaping happens after interpolation: the dangerous string is
    // the *lead's* data, which no admin reviewed.
    const html = renderDocument(
      parseDocument(paragraph('Hello {{name}}')),
      new Map([['name', '<img src=x onerror=alert(1)>']]),
    );
    expect(html).toBe('<p>Hello &lt;img src=x onerror=alert(1)&gt;</p>');
    expect(html).not.toContain('<img');
  });

  it('does not re-expand a token that arrives inside a value', () => {
    const html = renderDocument(
      parseDocument(paragraph('Hi {{name}}')),
      new Map([
        ['name', '{{email}}'],
        ['email', 'secret@example.test'],
      ]),
    );
    expect(html).toContain('{{email}}');
    expect(html).not.toContain('secret@example.test');
  });

  it('renders marks and links around escaped text', () => {
    const html = renderDocument(
      parseDocument({
        blocks: [
          {
            type: 'paragraph',
            spans: [
              { text: 'bold & linked', marks: ['bold'], href: 'https://example.test/?a=1&b=2' },
            ],
          },
        ],
      }),
      noVariables,
    );
    expect(html).toBe(
      '<p><a href="https://example.test/?a=1&amp;b=2"><strong>bold &amp; linked</strong></a></p>',
    );
  });

  it('renders lists and headings', () => {
    const html = renderDocument(
      parseDocument({
        blocks: [
          { type: 'heading', spans: [{ text: 'Update' }] },
          { type: 'numbered_list', items: [[{ text: 'First' }]] },
        ],
      }),
      noVariables,
    );
    expect(html).toBe('<h2>Update</h2>\n<ol><li>First</li></ol>');
  });

  it('leaves an unknown token alone and renders a missing value as empty', () => {
    expect(renderDocument(parseDocument(paragraph('{{invented}}')), noVariables)).toBe(
      '<p>{{invented}}</p>',
    );
    expect(renderDocument(parseDocument(paragraph('[{{phone}}]')), new Map([['phone', '']]))).toBe(
      '<p>[]</p>',
    );
  });
});

describe('campaign variables', () => {
  const fieldA = '66666666-6666-6666-6666-666666666666';
  const fieldB = '66666666-6666-6666-6666-666666666667';

  it('builds each recipient’s own values', () => {
    const variables = variablesFor({
      name: 'Synthetic Seller',
      email: null,
      phone: '900000000',
      fieldValues: { [fieldA]: 'alpha', [fieldB]: 42 },
    });
    expect(variables.get('name')).toBe('Synthetic Seller');
    expect(variables.get('email')).toBe('');
    expect(variables.get(`field:${fieldA}`)).toBe('alpha');
    expect(variables.get(`field:${fieldB}`)).toBe('42');
  });

  it('refuses a field token the author cannot view', () => {
    const document = parseDocument(paragraph(`Hi {{name}}, ref {{field:${fieldB}}}`));
    expect(unauthorizedTokens(document, new Set([fieldA]))).toEqual([`field:${fieldB}`]);
    expect(unauthorizedTokens(document, new Set([fieldA, fieldB]))).toEqual([]);
  });

  it('treats an unknown non-field token as literal text, not a denial', () => {
    const document = parseDocument(paragraph('50% off {{not_a_token}}'));
    expect(unauthorizedTokens(document, new Set())).toEqual([]);
  });

  it('finds tokens in list items as well as paragraphs', () => {
    const document = parseDocument({
      blocks: [{ type: 'bullet_list', items: [[{ text: '{{name}}' }, { text: ' {{phone}}' }]] }],
    });
    expect(documentTokens(document).sort()).toEqual(['name', 'phone']);
  });
});
