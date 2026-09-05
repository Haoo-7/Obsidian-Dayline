// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  ItemView: class {
    constructor(leaf) {
      this.leaf = leaf;
      this.contentEl = {};
      this.containerEl = {};
    }
  },
  Notice: class {},
  TFile: class {},
  setIcon: vi.fn(),
}));

import { JournalTimelineView } from '../src/journal-timeline-view';

function mobilePlugin(initialFilter = {}) {
  let savedFilter = { ...initialFilter };
  return {
    capabilities: { isMobile: true },
    journalIndex: { isReady: true },
    _getMobileTimelineFilter: vi.fn(() => ({ ...savedFilter })),
    _setMobileTimelineFilter: vi.fn((filter) => { savedFilter = { ...filter }; }),
    currentFilter: () => ({ ...savedFilter }),
  };
}

describe('mobile timeline filter lifecycle', () => {
  it('restores a calendar date filter when the real timeline ItemView is rebuilt', () => {
    const plugin = mobilePlugin();
    const first = new JournalTimelineView({}, plugin);
    first.render = vi.fn();

    first.setDateFilter('2026-07-20');

    expect(first.render).toHaveBeenCalledTimes(1);
    expect(plugin.currentFilter()).toEqual({ from: '2026-07-20', to: '2026-07-20' });

    const rebuilt = new JournalTimelineView({}, plugin);
    expect(rebuilt.filter).toEqual({ from: '2026-07-20', to: '2026-07-20' });
  });

  it('keeps cleared filters cleared across a subsequent real timeline rebuild', () => {
    const plugin = mobilePlugin({ from: '2026-07-20', to: '2026-07-20' });
    const timeline = new JournalTimelineView({}, plugin);

    timeline.filter = {};
    timeline._persistMobileTimelineFilter();

    expect(plugin.currentFilter()).toEqual({});
    expect(new JournalTimelineView({}, plugin).filter).toEqual({});
  });

  it('does not share timeline filter state with desktop ItemViews', () => {
    const plugin = {
      capabilities: { isMobile: false },
      journalIndex: { isReady: true },
      _getMobileTimelineFilter: vi.fn(() => ({ from: '2026-07-20', to: '2026-07-20' })),
      _setMobileTimelineFilter: vi.fn(),
    };
    const timeline = new JournalTimelineView({}, plugin);
    timeline.render = vi.fn();

    timeline.setDateFilter('2026-07-21');

    expect(timeline.filter).toEqual({ from: '2026-07-21', to: '2026-07-21' });
    expect(plugin._getMobileTimelineFilter).not.toHaveBeenCalled();
    expect(plugin._setMobileTimelineFilter).not.toHaveBeenCalled();
  });
});
