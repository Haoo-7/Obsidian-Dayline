import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_DAYLINE_VIEW,
  bindMobileEmbeddedViewHost,
  createSerialDaylineModeSwitcher,
  getMobileDaylineLeaf,
  getMobileMarkdownLeaf,
  isDaylineMobileMode,
  normalizeDaylineMobileMode,
} from '../src/dayline-mobile';

describe('mobile Dayline routing', () => {
  it('reuses the existing Dayline tab before asking the workspace for a leaf', () => {
    const existing = { id: 'dayline' };
    const workspace = {
      getLeavesOfType: vi.fn(() => [existing]),
      getLeaf: vi.fn(),
      leftSplit: { children: [] },
    };

    expect(getMobileDaylineLeaf(workspace)).toBe(existing);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(workspace.leftSplit).toBeDefined();
  });

  it('creates a tab without touching sidebar routing APIs', () => {
    const created = { id: 'new-dayline' };
    const workspace = {
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: string) => kind === 'tab' ? created : null),
      getLeftLeaf: vi.fn(() => { throw new Error('mobile must not use getLeftLeaf'); }),
    };

    expect(getMobileDaylineLeaf(workspace, MOBILE_DAYLINE_VIEW)).toBe(created);
    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
  });

  it('opens a mobile journal note in a Markdown tab rather than replacing Dayline', () => {
    const markdown = { id: 'note', view: { getViewType: () => 'markdown' } };
    const workspace = {
      activeLeaf: { id: 'dayline', view: { getViewType: () => MOBILE_DAYLINE_VIEW } },
      getLeavesOfType: vi.fn((type: string) => type === 'markdown' ? [markdown] : []),
      getLeaf: vi.fn(() => { throw new Error('must reuse Markdown before creating a tab'); }),
    };
    expect(getMobileMarkdownLeaf(workspace)).toBe(markdown);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  it('creates a normal mobile tab for a journal note when no Markdown tab exists', () => {
    const tab = { id: 'new-note' };
    const workspace = {
      activeLeaf: { id: 'dayline', view: { getViewType: () => MOBILE_DAYLINE_VIEW } },
      getLeavesOfType: vi.fn(() => []),
      getLeaf: vi.fn((kind: string) => kind === 'tab' ? tab : null),
      getLeftLeaf: vi.fn(() => { throw new Error('mobile must not use sidebar routing'); }),
    };
    expect(getMobileMarkdownLeaf(workspace)).toBe(tab);
    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
  });

  it('normalizes internal mode state to the two supported modes', () => {
    expect(normalizeDaylineMobileMode('timeline')).toBe('timeline');
    expect(normalizeDaylineMobileMode('calendar')).toBe('calendar');
    expect(normalizeDaylineMobileMode('unknown')).toBe('calendar');
    expect(isDaylineMobileMode('timeline', 'timeline')).toBe(true);
    expect(isDaylineMobileMode('calendar', 'timeline')).toBe(false);
  });

  it('serializes embedded mode lifecycle work in click order', async () => {
    const transitions: string[] = [];
    let releaseCalendar: (() => void) | undefined;
    const switchMode = createSerialDaylineModeSwitcher(async (mode) => {
      transitions.push(`start:${mode}`);
      if (mode === 'calendar') await new Promise<void>((resolve) => { releaseCalendar = resolve; });
      transitions.push(`end:${mode}`);
    });
    const calendar = switchMode('calendar');
    const timeline = switchMode('timeline');
    await vi.waitFor(() => expect(transitions).toEqual(['start:calendar']));
    releaseCalendar?.();
    await Promise.all([calendar, timeline]);
    expect(transitions).toEqual(['start:calendar', 'end:calendar', 'start:timeline', 'end:timeline']);
  });

  it('binds an embedded renderer to its mobile host and fails fast without one', () => {
    const view: any = {};
    const host = {};
    bindMobileEmbeddedViewHost(view, host);
    expect(view.containerEl).toBe(host);
    expect(view.contentEl).toBe(host);
    expect(() => bindMobileEmbeddedViewHost(null, host)).toThrow('requires a host');
  });
});
