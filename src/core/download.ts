/*
 * Saving a file the game made (a set, a cover, a settings backup, a board).
 * In an ordinary browser tab it's a plain download. Inside the claude.ai
 * artifact viewer, which doesn't allow plain downloads, it goes through the
 * viewer's own save prompt (`claude.use('downloads')`) instead; that prompt
 * only takes some file types (video, pictures, text, JSON, zip…), so audio
 * files say so and point at the downloaded copy of the game.
 */
import { toast } from '../ui/toast';

interface ViewerDownloads {
  save(r: { filename: string; data: Blob | string }): Promise<{ status: string }>;
}
interface ViewerClaude {
  use(name: 'downloads'): Promise<ViewerDownloads | null>;
}

let viewer: Promise<ViewerDownloads | null> | null = null;

/** the artifact viewer's save prompt, or null in an ordinary tab */
function viewerDownloads(): Promise<ViewerDownloads | null> {
  if (!viewer) {
    const c = (window as unknown as { claude?: ViewerClaude }).claude;
    viewer = c && typeof c.use === 'function' ? c.use('downloads').catch(() => null) : Promise.resolve(null);
  }
  return viewer;
}

function plainDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Save `data` as `name`. Resolves once it's handed over (or refused, with a message). */
export async function saveFile(data: Blob | string, name: string, type = 'application/octet-stream'): Promise<void> {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const d = await viewerDownloads();
  if (!d) {
    try {
      plainDownload(blob, name);
    } catch {
      toast('Downloads are blocked here.', 'error');
    }
    return;
  }
  try {
    await d.save({ filename: name, data: blob });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'declined') return;
    if (code === 'rejected_extension' || code === 'extension_not_enabled') toast(`This viewer can’t save .${name.split('.').pop()} files. Open the downloaded game (Deckhouse-DJ.html) to export them.`, 'error', 6000);
    else if (code === 'rate_limited') toast('A save is already waiting for you to confirm.', 'error');
    else toast('Saving files isn’t available here.', 'error');
  }
}
