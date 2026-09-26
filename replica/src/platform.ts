import { downloadBlob, safeFilename } from './dom';
import { zipFiles } from './zip';

interface DownloadsNamespace {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}
interface HostClaude {
  use(name: string): Promise<unknown>;
}

const host = (): HostClaude | undefined => (window as unknown as { claude?: HostClaude }).claude;

/** True when the page runs inside a claude.ai artifact frame. */
export const inArtifact = () => typeof host()?.use === 'function';

let downloads: Promise<DownloadsNamespace | null> | null = null;

/**
 * Saves an STL file. On a normal website it's a plain .stl download. Inside a claude.ai artifact
 * only some file types may be saved, so the STL goes inside a .zip. Returns a message to show,
 * or null when there is nothing to say.
 */
export async function saveStl(stl: ArrayBuffer, name: string): Promise<string | null> {
  const base = safeFilename(name);
  const claude = host();
  if (!claude?.use) {
    downloadBlob(stl, `${base}.stl`);
    return null;
  }
  downloads ??= claude.use('downloads').then((d) => (d as DownloadsNamespace | null) ?? null, () => null);
  const ns = await downloads;
  if (!ns) return 'Saving files isn’t available in this view.';
  const zip = await zipFiles([{ name: `${base}.stl`, data: new Uint8Array(stl.slice(0)) }]);
  try {
    await ns.save({ filename: `${base}.zip`, data: zip });
    return null;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'declined') return null;
    if (code === 'rate_limited') return 'A save prompt is already open.';
    return 'Couldn’t save the file here.';
  }
}
