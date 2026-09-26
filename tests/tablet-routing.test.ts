import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectPlatformCapabilities, usesPhoneLayout } from '../src/platform-capabilities';
import { calendarCellTouchRouting } from '../src/touch-targets';

const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
const timelineSource = readFileSync(new URL('../src/journal-timeline-view.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function sliceBetween(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  expect(start, `missing source token: ${startToken}`).toBeGreaterThan(-1);
  const end = source.indexOf(endToken, start);
  expect(end, `missing source token: ${endToken}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function tabletCapabilities() {
  return detectPlatformCapabilities({
    Platform: { isMobile: true, isMobileApp: true, isPhone: false, isTablet: true, isIosApp: true },
    document: { createElement: () => ({ getContext: () => ({}), canPlayType: () => 'maybe' }) },
    navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    WebAssembly: { instantiate() {} },
    matchMedia: () => ({ matches: true }),
    app: { fileManager: { getAvailablePathForAttachment() {} }, vault: { createBinary() {} } },
  });
}

function phoneCapabilities() {
  return detectPlatformCapabilities({
    Platform: { isMobile: true, isMobileApp: true, isPhone: true, isTablet: false, isIosApp: true },
    document: { createElement: () => ({ getContext: () => ({}), canPlayType: () => 'maybe' }) },
    navigator: { maxTouchPoints: 5, deviceMemory: 8, hardwareConcurrency: 8 },
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    WebAssembly: { instantiate() {} },
    matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') }),
    app: { fileManager: { getAvailablePathForAttachment() {} }, vault: { createBinary() {} } },
  });
}

describe('tablet vs phone layout routing', () => {
  it('routes a tablet to the sidebar path instead of the phone single-leaf swap', () => {
    const tablet = tabletCapabilities();
    expect(tablet.isTablet).toBe(true);
    expect(tablet.isTabletLayout).toBe(true);
    expect(usesPhoneLayout(tablet)).toBe(false);

    // Every top-level entry point must branch on the layout, not on isMobile.
    expect(pluginSource).not.toContain("if (this.capabilities?.isMobile) return this._activateMobileMode('calendar');");
    expect(pluginSource).not.toContain("if (this.capabilities?.isMobile) return this._activateMobileMode('timeline');");
    expect(pluginSource).toContain('_usesPhoneDaylineMode()');
    expect(pluginSource).toContain('usesPhoneLayout(this.capabilities)');
  });

  it('keeps the phone layout on the single-leaf swap and mode controls', () => {
    const phone = phoneCapabilities();
    expect(phone.isPhone).toBe(true);
    expect(phone.isPhoneLayout).toBe(true);
    expect(phone.isTabletLayout).toBe(false);
    expect(usesPhoneLayout(phone)).toBe(true);

    // Mode controls are the phone's only way to switch views, so they must stay
    // gated on the phone layout rather than disappearing with the mobile flag.
    expect(pluginSource).toContain('if (!usesPhoneLayout(this.plugin.capabilities)) return;');
    expect(timelineSource).toContain('if (!usesPhoneLayout(this.plugin.capabilities)) return;');
    expect(pluginSource).toContain("renderMobileDaylineModeControls(root");
    expect(timelineSource).toContain("renderMobileDaylineModeControls(root");
  });

  it('lets tablets open journal entries in the existing leaf without creating a tab', () => {
    const openSource = sliceBetween(pluginSource, 'async openJournalFile(file)', 'async _openTimelineView()');
    // getJournalOpenLeaf only creates a tab when the phone layout is active.
    expect(openSource).toContain('getJournalOpenLeaf(workspace, this._usesPhoneDaylineMode())');
    expect(openSource).not.toContain("getLeaf('split')");
    expect(openSource).toContain('await workspace.revealLeaf?.(leaf);');
  });

  it('shows in-cell calendar controls on tablets but keeps the phone cell single-surface', () => {
    // A tablet is a coarse pointer but not a phone, so it gets the full cell UI.
    const tablet = calendarCellTouchRouting(true, false);
    expect(tablet.showMoodControl).toBe(true);
    expect(tablet.showEntryCountControl).toBe(true);
    expect(tablet.showMediaInfoControl).toBe(true);
    expect(tablet.secondary).toBe('in-cell');

    const phone = calendarCellTouchRouting(true, true);
    expect(phone.showMoodControl).toBe(false);
    expect(phone.showEntryCountControl).toBe(false);
    expect(phone.secondary).toBe('external-surface');

    // The render call must pass the phone-layout decision, not raw isMobile.
    expect(pluginSource).toContain('usesPhoneLayout(this.plugin.capabilities),');
  });

  it('only renders the mood control where a mood or journal entry exists', () => {
    // An empty frame on every date littered the grid with targets that stole
    // taps from the date itself, so the control is gated on real content.
    const renderSource = sliceBetween(pluginSource, 'const hasMoodTarget', 'On This Day dot marker');
    expect(renderSource).toContain('const hasMoodTarget = Boolean(mood) || Boolean(dateEntry.hasRecord);');
    // The guard itself must use it; declaring the flag is not enough.
    const guard = renderSource.slice(renderSource.indexOf('if (touchRouting.showMoodControl'));
    expect(guard.slice(0, guard.indexOf('{'))).toContain('hasMoodTarget');
  });

  it('opens the mood picker on click rather than pointerdown', () => {
    // Opening on pointerdown put the modal under the finger before release, so
    // the tap's trailing click hit the modal backdrop and dismissed the picker
    // unless the user kept holding the button down.
    const renderSource = sliceBetween(pluginSource, 'const hasMoodTarget', 'On This Day dot marker');
    const clickHandler = renderSource.slice(renderSource.indexOf("addEventListener('click'"));
    expect(clickHandler.slice(0, clickHandler.indexOf('});'))).toContain('openMoodPicker');

    // The pointerdown handler must only claim the press; opening there is the bug.
    const downHandler = renderSource.slice(renderSource.indexOf("addEventListener('pointerdown'"));
    const downBody = downHandler.slice(0, downHandler.indexOf('});'));
    expect(downBody).toContain('stopPropagation');
    expect(downBody).not.toContain('openMoodPicker');
  });

  it('squares the tablet icon buttons that Obsidian pads as text buttons', () => {
    // Obsidian's `.is-tablet button:not(.clickable-icon) { padding: 4px 20px }`
    // outranks `.cal-icon-button`, collapsing a 44px button's glyph to ~4px.
    expect(stylesSource).toContain('body.dayline-tablet .cal-icon-button,');
    const rule = stylesSource.slice(stylesSource.indexOf('body.dayline-tablet .cal-icon-button,'));
    expect(rule).toContain('padding: 8px');
    expect(rule).toContain('min-width: 44px');
  });

  it('scopes the coarse-pointer in-cell CSS to the phone layout, not all mobile hosts', () => {
    // Tablets now render the in-cell affordances, so the exclusion must not
    // hide them behind a dayline-mobile check.
    expect(stylesSource).not.toContain('.dayline-coarse-pointer:not(.dayline-mobile)');
    expect(stylesSource).toContain('.dayline-coarse-pointer:not(.dayline-phone)');
  });

  it('applies a tablet class and keeps the calendar grid from stretching', () => {
    expect(pluginSource).toContain("classList.toggle('dayline-tablet'");
    expect(pluginSource).toContain("classList.remove('dayline-coarse-pointer', 'dayline-mobile', 'dayline-phone', 'dayline-tablet')");
    const tabletRule = stylesSource.slice(stylesSource.indexOf('body.dayline-tablet .cal-grid'));
    expect(tabletRule).toContain('max-width: 560px');
  });

  it('keeps tablet dialogs on the desktop picker rather than the phone viewport bind', () => {
    // The keyboard-constrained phone modal must not be applied to tablets.
    const viewportSource = readFileSync(new URL('../src/mood-modal-viewport.ts', import.meta.url), 'utf8');
    expect(viewportSource).toContain("doc.body.matches('.dayline-mobile.dayline-phone')");
  });
});
