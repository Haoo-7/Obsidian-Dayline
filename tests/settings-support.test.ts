import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import {
  renderSupportSection,
  SUPPORT_CHECK_CLASS,
  SUPPORT_CONTAINER_CLASS,
  SUPPORT_DRAWER_CLASS,
  SUPPORT_QR_CLASS,
  SUPPORT_REPOSITORY_URL,
  SUPPORT_STAR_CLASS,
  SUPPORT_TOGGLE_CLASS,
} from '../src/settings-support';

const STRINGS: Record<string, string> = {
  supportAboutName: 'About Dayline',
  supportAboutDesc: 'v{version} · MIT licence · by Haoo',
  supportCheckUpdate: 'Check for updates',
  supportChecking: 'Checking…',
  supportCoffeeName: 'Buy the author a coffee',
  supportCoffeeDesc: 'Dayline is free and no feature is paywalled.',
  supportExpand: 'Expand',
  supportCollapse: 'Collapse',
  supportScanTitle: 'Scan with WeChat, any amount',
  supportScanNote: 'A tip never unlocks a feature.',
  supportUses: 'It turns into coffee and cat food.',
  supportStar: 'Or just give it a star.',
  supportQrAlt: "Haoo's WeChat tip code",
};

function localize(key: string, values?: Record<string, unknown>): string {
  let out = STRINGS[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) out = out.replaceAll(`{${name}}`, String(value));
  return out;
}

const QR_SRC = 'data:image/jpeg;base64,AAAA';
const VERSION = '2.10.1';

function mount(overrides: Partial<Parameters<typeof renderSupportSection>[1]> = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = renderSupportSection(container, { localize, qrSrc: QR_SRC, version: VERSION, doc, ...overrides });
  const toggle = () => root.querySelector(`.${SUPPORT_TOGGLE_CLASS}`) as HTMLButtonElement;
  const drawer = () => root.querySelector(`.${SUPPORT_DRAWER_CLASS}`) as HTMLElement;
  return { dom, doc, container, root, toggle, drawer };
}

describe('settings support section', () => {
  it('opens by default, because the block has one visit to be useful', () => {
    const { root, toggle, drawer } = mount();

    expect(root.classList.contains(SUPPORT_CONTAINER_CLASS)).toBe(true);
    expect(drawer().hidden).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).toContain('Collapse');
    expect(root.classList.contains('is-open')).toBe(true);
  });

  it('closes and reopens from the single toggle and keeps the label in step', () => {
    const { root, toggle, drawer } = mount();

    toggle().click();
    expect(drawer().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Expand');
    expect(root.classList.contains('is-open')).toBe(false);

    toggle().click();
    expect(drawer().hidden).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).toContain('Collapse');
  });

  it('points the toggle at the drawer it controls', () => {
    const { toggle, drawer } = mount();

    expect(drawer().id).not.toBe('');
    expect(toggle().getAttribute('aria-controls')).toBe(drawer().id);
  });

  it('builds ordinary settings rows, so the pane styles them like its neighbours', () => {
    const { root } = mount();

    const rows = root.querySelectorAll('.setting-item');
    expect(rows).toHaveLength(2);
    expect(root.querySelector('.setting-item-info .setting-item-name')?.textContent)
      .toBe(STRINGS.supportAboutName);
    expect(root.querySelector('.setting-item-description')?.textContent)
      .toBe(`v${VERSION} · MIT licence · by Haoo`);
    // The control slot is what the theme styles; a custom row would drift from it.
    expect(root.querySelector('.setting-item-control button')).not.toBeNull();
  });

  it('renders no update button when no check is wired', () => {
    const { root } = mount();

    expect(root.querySelector(`.${SUPPORT_CHECK_CLASS}`)).toBeNull();
  });

  it('disables the update button for the length of the check', async () => {
    let release = () => {};
    const checkUpdate = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { root } = mount({ checkUpdate });

    const button = root.querySelector(`.${SUPPORT_CHECK_CLASS}`) as HTMLButtonElement;
    expect(button.textContent).toBe(STRINGS.supportCheckUpdate);

    button.click();
    expect(checkUpdate).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(STRINGS.supportChecking);

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe(STRINGS.supportCheckUpdate);
  });

  it('keeps the no-money alternative on the repository, opened outside the app', () => {
    const { root } = mount();

    const link = root.querySelector(`.${SUPPORT_STAR_CLASS} a`) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe(SUPPORT_REPOSITORY_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toBe(STRINGS.supportStar);
  });

  it('renders the tip code as an inlined image with an accessible name', () => {
    const { root } = mount();

    const qr = root.querySelector(`.${SUPPORT_QR_CLASS}`) as HTMLImageElement;
    expect(qr).not.toBeNull();
    expect(qr.getAttribute('src')).toBe(QR_SRC);
    expect(qr.getAttribute('alt')).toBe(STRINGS.supportQrAlt);
  });

  it('says nothing is paywalled before the code appears in reading order', () => {
    const { root } = mount();

    const text = root.textContent ?? '';
    expect(text.indexOf(STRINGS.supportCoffeeDesc)).toBeGreaterThan(-1);
    expect(text.indexOf(STRINGS.supportCoffeeDesc))
      .toBeLessThan(text.indexOf(STRINGS.supportScanTitle));
  });
});
