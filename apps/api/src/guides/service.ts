import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type GuideId = 'admin' | 'user';

const GUIDE_FILES: Record<GuideId, { fileName: string; title: string }> = {
  admin: { fileName: 'admin-guide.md', title: 'Admin Guide' },
  user: { fileName: 'user-guide.md', title: 'User Guide' },
};

export function isGuideId(value: string): value is GuideId {
  return value === 'admin' || value === 'user';
}

// `dist/guides/service.js` -> `dist` -> `api` -> `apps` -> repo root. The
// Docker image mirrors this exact layout (see Dockerfile, which copies
// `docs/guides` alongside `apps/api/dist`), so the same relative path
// resolves correctly in both `pnpm dev` and the built image.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

export interface GuideContent {
  content: string;
  fileName: string;
  title: string;
}

/**
 * Reads one of the two static guide documents straight off disk — there is
 * no database row for these, they are Markdown checked into `docs/guides/`.
 * Returns `null` if the file is missing (a bad deploy, not a caller error).
 */
export async function readGuide(guide: GuideId): Promise<GuideContent | null> {
  const meta = GUIDE_FILES[guide];
  try {
    const content = await readFile(join(repoRoot, 'docs', 'guides', meta.fileName), 'utf-8');
    return { content, fileName: meta.fileName, title: meta.title };
  } catch {
    return null;
  }
}
