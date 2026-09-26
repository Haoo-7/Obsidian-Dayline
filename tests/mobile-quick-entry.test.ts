// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_QUICK_ENTRY_ICON,
  MOBILE_QUICK_ENTRY_TITLE,
  createMobileMarkdownQuickEntry,
} from '../src/mobile-quick-entry';

const pluginSource = readFileSync(join(process.cwd(), 'src/plugin.ts'), 'utf8');
const stylesSource = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');
const quickEntrySource = readFileSync(join(process.cwd(), 'src/mobile-quick-entry.ts'), 'utf8');

function phoneCapabilities(overrides: Record<string, boolean> = {}) {
  return {
    isMobile: true,
    isMobileApp: true,
    isPhone: true,
    isTablet: false,
    isDesktop: false,
    ...overrides,
  };
}

function markdownLeaf(overrides: { view?: Record<string, unknown> } = {}) {
  const actions: HTMLButtonElement[] = [];
  const view = {
    getViewType: () => 'markdown',
    addAction: vi.fn((_icon: string, _title: string, callback: (event: MouseEvent) => unknown) => {
      const action = document.createElement('button');
      action.addEventListener('click', callback);
      document.body.append(action);
      actions.push(action);
      return action;
    }),
    ...overrides.view,
  };
  return {
    view,
    actions,
    get action() {
      return actions.at(-1);
    },
  };
}

function pluginFor(leaf: unknown, capabilities = phoneCapabilities()) {
  return {
    capabilities,
    app: { workspace: { activeLeaf: leaf } },
    _mobileDaylineLastMode: undefined as unknown,
    _activateMobileMode: vi.fn(),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('mobile Markdown quick entry', () => {
  it('installs one Dayline action on an active phone-app Markdown view', () => {
    const leaf = markdownLeaf();
    const plugin = pluginFor(leaf);
    const controller = createMobileMarkdownQuickEntry(plugin);

    controller.sync();

    expect(leaf.view.addAction).toHaveBeenCalledTimes(1);
    expect(leaf.view.addAction).toHaveBeenCalledWith(
      MOBILE_QUICK_ENTRY_ICON,
      MOBILE_QUICK_ENTRY_TITLE,
      expect.any(Function),
    );
    expect(leaf.action?.isConnected).toBe(true);
  });

  it.each([
    ['desktop', { isMobile: false, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: true }],
    ['tablet app', { isMobile: true, isMobileApp: true, isPhone: false, isTablet: true, isDesktop: false }],
    ['desktop mobile emulation', { isMobile: true, isMobileApp: false, isPhone: false, isTablet: false, isDesktop: false }],
  ])('does not install the action on %s', (_label, capabilities) => {
    const leaf = markdownLeaf();
    const controller = createMobileMarkdownQuickEntry(pluginFor(leaf, phoneCapabilities(capabilities)));

    controller.sync();

    expect(leaf.view.addAction).not.toHaveBeenCalled();
  });

  it.each([
    ['calendar-sidebar-view'],
    ['journal-timeline-view'],
    ['dayline-mobile-view'],
    ['canvas'],
    ['settings'],
    ['other-plugin-view'],
  ])('does not install the action on %s', (viewType) => {
    const leaf = markdownLeaf({ view: { getViewType: () => viewType } });
    const controller = createMobileMarkdownQuickEntry(pluginFor(leaf));

    controller.sync();

    expect(leaf.view.addAction).not.toHaveBeenCalled();
  });

  it('does not add a duplicate action after repeated workspace events', () => {
    const leaf = markdownLeaf();
    const controller = createMobileMarkdownQuickEntry(pluginFor(leaf));

    controller.sync();
    controller.sync();
    controller.sync();

    expect(leaf.view.addAction).toHaveBeenCalledTimes(1);
  });

  it('opens the last Dayline mode from the Markdown action and defaults to calendar', () => {
    const leaf = markdownLeaf();
    const plugin = pluginFor(leaf);
    const controller = createMobileMarkdownQuickEntry(plugin);
    controller.sync();

    leaf.action?.click();
    expect(plugin._activateMobileMode).toHaveBeenCalledWith('calendar');

    plugin._mobileDaylineLastMode = 'timeline';
    leaf.action?.click();
    expect(plugin._activateMobileMode).toHaveBeenLastCalledWith('timeline');
  });

  it('removes a stale action when the leaf view is replaced and installs on the new Markdown view', () => {
    const first = markdownLeaf();
    const leaf = { view: first.view as unknown };
    const plugin = pluginFor(leaf);
    const controller = createMobileMarkdownQuickEntry(plugin);
    controller.sync();
    expect(first.action?.isConnected).toBe(true);

    const second = markdownLeaf();
    leaf.view = second.view;
    controller.sync();

    expect(first.action?.isConnected).toBe(false);
    expect(second.view.addAction).toHaveBeenCalledTimes(1);
    expect(second.action?.isConnected).toBe(true);
  });

  it('reinstalls after a disconnected action and removes every tracked action on dispose', () => {
    const leaf = markdownLeaf();
    const plugin = pluginFor(leaf);
    const controller = createMobileMarkdownQuickEntry(plugin);
    controller.sync();
    expect(leaf.view.addAction).toHaveBeenCalledTimes(1);

    leaf.action?.remove();
    controller.sync();
    expect(leaf.view.addAction).toHaveBeenCalledTimes(2);
    expect(leaf.action?.isConnected).toBe(true);

    controller.dispose();
    expect(leaf.action?.isConnected).toBe(false);
  });

  it('fails quietly when addAction is missing, throws, or returns nothing removable', () => {
    const missing = markdownLeaf({ view: { addAction: undefined } });
    delete (missing.view as { addAction?: unknown }).addAction;
    const throwing = markdownLeaf({
      view: { addAction: vi.fn(() => { throw new Error('addAction unavailable'); }) },
    });
    const invalid = markdownLeaf({ view: { addAction: vi.fn(() => ({}) ) } });
    const empty = markdownLeaf({ view: { addAction: vi.fn(() => null) } });

    expect(() => createMobileMarkdownQuickEntry(pluginFor(missing)).sync()).not.toThrow();
    expect(() => createMobileMarkdownQuickEntry(pluginFor(throwing)).sync()).not.toThrow();
    expect(() => createMobileMarkdownQuickEntry(pluginFor(invalid)).sync()).not.toThrow();
    expect(() => createMobileMarkdownQuickEntry(pluginFor(empty)).sync()).not.toThrow();
    expect(throwing.view.addAction).toHaveBeenCalledTimes(1);
    expect(invalid.view.addAction).toHaveBeenCalledTimes(1);
    expect(empty.view.addAction).toHaveBeenCalledTimes(1);
  });

  it('hooks existing workspace listeners and phone capability classes without a bottom-bar injector', () => {
    expect(pluginSource).toContain('createMobileMarkdownQuickEntry');
    expect(pluginSource).toContain('this._mobileQuickEntry?.sync()');
    expect(pluginSource).toContain('this._mobileQuickEntry?.dispose()');
    expect(pluginSource).toContain("classList.toggle('dayline-phone'");
    expect(pluginSource).toContain("classList.remove('dayline-coarse-pointer', 'dayline-mobile', 'dayline-phone', 'dayline-tablet')");
    expect(stylesSource).toContain('body.dayline-mobile.dayline-phone .journal-mood-picker-modal');
    expect(stylesSource).toContain('100dvh');
    expect(stylesSource).toContain('env(safe-area-inset-bottom)');
    expect(stylesSource).toContain('width: 52px');
    expect(stylesSource).toContain('position: sticky');
    expect(quickEntrySource).not.toContain('querySelector');
    expect(quickEntrySource).not.toContain('mobile-navbar');
    expect(quickEntrySource).not.toContain('workspace-drawer');
    expect(quickEntrySource).not.toContain('status-bar');
  });
});
