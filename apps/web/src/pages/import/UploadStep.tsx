import { useRef, useState, type DragEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/cn';

/**
 * Step one.
 *
 * The drop zone is a `<label>` wrapping a real file input rather than a div
 * with a click handler, so keyboard and screen-reader users get the browser's
 * own file picker affordance instead of a target they cannot reach.
 */
export function UploadStep({
  onFile,
  isPending,
  error,
}: {
  onFile: (file: File) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (file: File | undefined) => {
    if (file) onFile(file);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <Banner tone="error">{error}</Banner> : null}
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors',
          dragging
            ? 'border-gold bg-gold-soft/25'
            : 'border-line-strong bg-surface hover:bg-surface-hover',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={isPending}
          onChange={(event) => {
            accept(event.target.files?.[0]);
            // Let the same file be chosen again after a failed parse.
            event.target.value = '';
          }}
        />
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-soft/40">
          {isPending ? (
            <Spinner size={22} tone="gold" />
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V17"
                stroke="var(--color-ink)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <Heading level="section">
          {isPending ? 'Reading your file…' : 'Drop a CSV here, or choose a file'}
        </Heading>
        <p className="max-w-md text-sm text-ink-soft">
          The first row is read as column names. Nothing is created until you have seen a preview
          and confirmed it.
        </p>
        <span className="mt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
          >
            Choose file
          </Button>
        </span>
      </label>
      <p className="text-xs text-ink-soft">
        Up to 5,000 rows and 5&nbsp;MB per file. Larger exports should be split before importing.
      </p>
    </div>
  );
}
