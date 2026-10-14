import { describe, expect, it } from 'vitest';
import manifestText from '../public/manifest.webmanifest?raw';
import { precacheList, serviceWorkerSource } from '../src/pwa/swSource';

const icons = Object.keys(import.meta.glob('../public/icons/*.png'));

describe('installable game (offline cache)', () => {
  const files = ['index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'assets/model.glb', 'icons/icon-192.png', 'manifest.webmanifest', '_headers', 'assets/index-abc.js.map', 'sw.js'];

  it('caches the page by its folder and every built file, but not the worker or host files', () => {
    const list = precacheList(files);
    expect(list[0]).toBe('./');
    expect(list).toContain('assets/index-abc.js');
    expect(list).toContain('assets/model.glb');
    expect(list).toContain('manifest.webmanifest');
    for (const no of ['index.html', 'sw.js', '_headers', 'assets/index-abc.js.map']) expect(list).not.toContain(no);
    expect(precacheList(['assets\\a.js'])).toContain('assets/a.js');
  });

  it('writes a worker that parses, named by its build', () => {
    const src = serviceWorkerSource(files, 'v123');
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('"v123"');
    expect(src).toContain('assets/index-abc.js');
  });

  it('has a manifest an installer accepts', () => {
    const m = JSON.parse(manifestText);
    expect(m.name).toBe('Deckhouse DJ');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBeTruthy();
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(icons).toContain(`../public/${i.src}`);
  });
});
