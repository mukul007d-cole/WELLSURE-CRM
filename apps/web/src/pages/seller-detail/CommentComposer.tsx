import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { friendlyErrorMessage } from '../../lib/api-error';

export function CommentComposer({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (text: string) => void;
  pending: boolean;
  error: unknown;
}) {
  const [text, setText] = useState('');

  return (
    <form
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = text.trim();
        if (!trimmed) return;
        // Cleared optimistically alongside the optimistic append; the mutation
        // restores nothing on failure because the entry itself rolls back and
        // the error banner explains why.
        setText('');
        onSubmit(trimmed);
      }}
    >
      <label htmlFor="seller-comment" className="sr-only">
        Add a comment
      </label>
      <textarea
        id="seller-comment"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        placeholder="Add a comment…"
        className="w-full resize-y rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-ink focus:outline-none"
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || text.trim() === ''}>
          {pending ? 'Posting…' : 'Comment'}
        </Button>
      </div>
    </form>
  );
}
