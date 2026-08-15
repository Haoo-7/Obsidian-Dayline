import { describe, expect, it, vi } from 'vitest';
import { JournalIndex } from '../src/journal-index';
import { subscribeJournalMetadataRefresh } from '../src/journal-metadata-refresh';

describe('journal metadata refresh', () => {
  it('reindexes a journal after Obsidian parses a newly added image embed', async () => {
    const file = {
      path: 'Calendar/Daily/2026-08-11.md',
      name: '2026-08-11.md',
      extension: 'md',
      frontmatter: {},
      content: '# August 11',
      embeds: [] as Array<{ link: string }>,
    };
    const app = {
      vault: {
        getMarkdownFiles: () => [file],
        getAbstractFileByPath: (path: string) => path === file.path ? file : null,
        cachedRead: async (current: typeof file) => current.content,
      },
      metadataCache: {
        getFileCache: (current: typeof file) => ({ frontmatter: current.frontmatter, embeds: current.embeds }),
      },
    };
    const index = new JournalIndex(app, () => undefined);
    await index.refresh({ dailyFolder: 'Calendar/Daily' });
    expect(index.getEntries()[0]?.attachments).toEqual([]);

    let onChanged: ((changedFile: typeof file) => Promise<void>) | undefined;
    const registerEvent = vi.fn();
    subscribeJournalMetadataRefresh({
      metadataCache: {
        on: (event: string, callback: typeof onChanged) => {
          expect(event).toBe('changed');
          onChanged = callback;
          return { id: 'metadata-changed' };
        },
      },
      registerEvent,
      journalIndex: index,
      getSettings: () => ({ dailyFolder: 'Calendar/Daily' }),
      onError: vi.fn(),
    });

    file.embeds = [{ link: 'IMG_9167.png' }];
    await onChanged?.(file);

    expect(registerEvent).toHaveBeenCalledWith({ id: 'metadata-changed' });
    expect(index.getEntries()[0]?.attachments).toEqual(['IMG_9167.png']);
  });
});
