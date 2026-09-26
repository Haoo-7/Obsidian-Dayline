import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderExifTooltip } from '../src/exif-tooltip';

/**
 * Obsidian augments `Node` with `createEl`/`createDiv`/`createSpan`. A bare
 * JSDOM document has none of them, so install the subset the tooltip uses
 * before rendering, mirroring what the Obsidian host provides at runtime.
 *
 * The prototype is patched through an `any` handle because the Obsidian
 * augmentations declare a much stricter signature than the runtime stub needs;
 * this file is test scaffolding, never shipped.
 */
function installObsidianDomHelpers(target: HTMLElement): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test scaffolding
  const proto = Object.getPrototypeOf(target) as any;
  proto.createEl = function (tag: string, options: { cls?: string; text?: string } = {}) {
    const element = target.ownerDocument.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.className = options.cls;
    this.append(element);
    return element;
  };
  proto.createDiv = function (options = {}) { return this.createEl('div', options); };
  proto.createSpan = function (options = {}) { return this.createEl('span', options); };
}

describe('EXIF tooltip rendering', () => {
  it('renders EXIF values as text instead of HTML', () => {
    const dom = new JSDOM('<div id="tip"></div>');
    const target = dom.window.document.querySelector('#tip') as HTMLElement;
    const previousDocument = globalThis.document;
    Object.assign(globalThis, { document: dom.window.document });
    installObsidianDomHelpers(target);
    try {
      renderExifTooltip(target, [{ key: 'exif_camera', value: '<img src=x onerror=alert(1)>' }], {
        loading: 'Loading',
        noData: 'No data',
        noDataDescription: 'None',
        label: () => 'Camera',
      });
      expect(target.querySelector('img')).toBeNull();
      expect(target.textContent).toContain('<img src=x onerror=alert(1)>');
    } finally {
      Object.assign(globalThis, { document: previousDocument });
    }
  });
});
