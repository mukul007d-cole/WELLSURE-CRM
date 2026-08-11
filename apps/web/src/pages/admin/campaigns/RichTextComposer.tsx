import { useEffect, useRef } from 'react';
import { Button } from '../../../components/ui/Button';
import type { CampaignDocument } from '../../../types/domain';
import { documentFromElement, elementHtmlFromDocument } from './campaign-document';

/**
 * Bold/italic/underline/lists over a `contentEditable` region.
 *
 * Deliberately no editor dependency: the requirement is a handful of inline
 * marks, `document.execCommand` covers exactly that in every browser we
 * support, and what leaves this component is a structured document rather than
 * the browser's HTML — so the usual reason to reach for a framework (taming
 * contentEditable's markup) doesn't apply. The markup here is a means, not the
 * stored artifact.
 */
export function RichTextComposer({
  value,
  onChange,
  onInsertToken,
}: {
  value: CampaignDocument;
  onChange: (document: CampaignDocument) => void;
  onInsertToken?: (insert: (token: string) => void) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const synced = useRef<string>('');

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const html = elementHtmlFromDocument(value);
    // Only write back when the document changed elsewhere; rewriting on every
    // keystroke would move the caret to the start of the region.
    if (html !== synced.current && element.innerHTML !== html) {
      element.innerHTML = html;
      synced.current = html;
    }
  }, [value]);

  const publish = () => {
    const element = ref.current;
    if (element === null) return;
    synced.current = element.innerHTML;
    onChange(documentFromElement(element));
  };

  /**
   * `execCommand` is deprecated and absent in some environments, so its absence
   * has to degrade rather than throw: formatting becomes a no-op and text
   * insertion appends instead of landing at the caret.
   */
  const applyCommand = (command: string, value?: string) => {
    const element = ref.current;
    if (element === null) return;
    element.focus();
    if (typeof document.execCommand === 'function') document.execCommand(command, false, value);
    else if (command === 'insertText' && value !== undefined) element.append(value);
    publish();
  };

  const exec = (command: string) => applyCommand(command);
  const insertToken = (token: string) => applyCommand('insertText', `{{${token}}}`);
  useEffect(() => onInsertToken?.(insertToken));

  return (
    <div className="rounded-control border border-line">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1">
        {[
          ['bold', 'Bold', 'B'],
          ['italic', 'Italic', 'I'],
          ['underline', 'Underline', 'U'],
          ['insertUnorderedList', 'Bullet list', '•'],
          ['insertOrderedList', 'Numbered list', '1.'],
        ].map(([command, label, glyph]) => (
          <Button
            key={command}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            onClick={() => exec(command!)}
          >
            {glyph}
          </Button>
        ))}
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label="Campaign body"
        aria-multiline="true"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        className="min-h-40 bg-surface p-3 text-sm text-ink outline-none"
        onInput={publish}
        onBlur={publish}
      />
    </div>
  );
}
