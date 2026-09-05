import { describe, expect, it } from 'vitest';
import { collectMobileDiagnostics, formatMobileDiagnostics } from '../src/mobile-diagnostics';

describe('mobile diagnostics', () => {
  it('collects privacy-safe platform and route information', () => {
    const activeLeaf = {
      view: {
        getViewType: () => 'journal-timeline-view',
        contentEl: { clientHeight: 320, scrollHeight: 960, childElementCount: 7 },
      },
    };
    const output = collectMobileDiagnostics({
      manifest: { version: '2.1.2' },
      capabilities: {
        isMobile: true, isIos: true, isAndroid: false, isDesktop: false,
        coarsePointer: true, memoryConstrained: false,
        routes: { mediaMetadata: 'fallback', heic: 'disabled' },
      },
      app: {
        workspace: {
          activeLeaf,
          getLeavesOfType: (viewType: string) => ({
            'calendar-sidebar-view': [{ id: 'calendar' }],
            'journal-timeline-view': [activeLeaf],
            'dayline-mobile-view': [],
          }[viewType] || []),
        },
      },
      journalIndex: { getEntries: () => [{ path: 'private-note.md' }] },
      _mobileDiagnosticEvents: [{ name: 'plugin-loaded', at: '2026-08-31T00:00:00.000Z' }],
    });

    expect(output.pluginVersion).toBe('2.1.2');
    expect(output.platform.isIos).toBe(true);
    expect(output.routes.heic).toBe('disabled');
    expect(output.activeViewType).toBe('journal-timeline-view');
    expect(output.daylineLeaves).toEqual({ calendar: 1, timeline: 1, legacy: 0, total: 2 });
    expect(output.activeContent).toEqual({ clientHeight: 320, scrollHeight: 960, childElementCount: 7 });
    expect(output.journalEntryCount).toBe(1);
    expect(formatMobileDiagnostics(output)).not.toContain('private-note.md');
  });

  it('bounds and sanitizes malformed event data without reading note contents', () => {
    const output = collectMobileDiagnostics({
      manifest: {},
      capabilities: { routes: { mediaMetadata: 'fallback' } },
      journalIndex: { getEntries: () => { throw new Error('index unavailable'); } },
      _mobileDiagnosticEvents: [
        ...Array.from({ length: 18 }, () => ({ name: 'mode-request:timeline', at: '2026-08-31T00:00:00.000Z' })),
        { name: 'Calendar/Daily/private-note.md', at: '/Users/haoo/secret.md' },
        null,
      ],
    });

    expect(output.pluginVersion).toBe('unknown');
    expect(output.journalEntryCount).toBeNull();
    expect(output.events).toHaveLength(19);
    expect(output.events.at(-1)).toEqual({ name: 'unknown', at: 'unknown' });
    expect(formatMobileDiagnostics(output)).not.toContain('private-note.md');
    expect(formatMobileDiagnostics(output)).not.toContain('/Users/haoo');
  });

  it('does not expose unknown active view types or user-facing identifiers', () => {
    const output = collectMobileDiagnostics({
      app: {
        workspace: {
          activeLeaf: {
            view: {
              getViewType: () => 'custom-plugin:private-note-title',
              contentEl: { clientHeight: 100, scrollHeight: 100, childElementCount: 1 },
            },
          },
          getLeavesOfType: () => [],
        },
      },
    });

    expect(output.activeViewType).toBe('other');
    expect(output.activeContent).toBeNull();
    expect(formatMobileDiagnostics(output)).not.toContain('private-note-title');
  });

  it('keeps only the latest twenty valid event slots', () => {
    const output = collectMobileDiagnostics({
      capabilities: {},
      _mobileDiagnosticEvents: Array.from({ length: 25 }, (_, index) => ({
        name: index === 24 ? 'plugin-loaded' : 'mode-request:calendar',
        at: '2026-08-31T00:00:00.000Z',
      })),
    });

    expect(output.events).toHaveLength(20);
    expect(output.events.at(-1)?.name).toBe('plugin-loaded');
  });
});
