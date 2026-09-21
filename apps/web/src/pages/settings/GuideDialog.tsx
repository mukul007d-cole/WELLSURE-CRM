import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { guidesApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Spinner } from '../../components/ui/Spinner';

function downloadText(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GuideDialog({
  guide,
  title,
  onClose,
}: {
  guide: 'admin' | 'user';
  title: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const query = useQuery({
    queryKey: qk.guide(guide),
    queryFn: () => guidesApi.get(guide),
    retry: false,
  });

  async function handleDownload() {
    setDownloading(true);
    try {
      const guideContent = await qc.fetchQuery({
        queryKey: qk.guide(guide),
        queryFn: () => guidesApi.get(guide),
      });
      downloadText(guideContent.content, guideContent.fileName);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button loading={downloading} onClick={() => void handleDownload()}>
            Download
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {query.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner size={24} tone="gold" label={`Loading ${title}`} />
          </div>
        ) : query.isError ? (
          <Banner tone="error">{friendlyErrorMessage(query.error)}</Banner>
        ) : (
          <article className="prose prose-sm max-w-none prose-headings:font-display prose-headings:text-ink prose-a:text-ink prose-strong:text-ink">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{query.data.content}</ReactMarkdown>
          </article>
        )}
      </div>
    </Dialog>
  );
}
