import type { JournalIndex, JournalIndexSettings } from './journal-index';

interface MetadataCache {
  on?(event: string, callback: (file: any) => Promise<void>): unknown;
}

interface JournalMetadataRefreshOptions {
  metadataCache: MetadataCache | undefined;
  registerEvent: (eventRef: unknown) => void;
  journalIndex: JournalIndex;
  getSettings: () => JournalIndexSettings;
  onError: (error: unknown, file: any) => void;
}

/** Re-read a note after Obsidian has finished updating its embed cache. */
export function subscribeJournalMetadataRefresh({
  metadataCache,
  registerEvent,
  journalIndex,
  getSettings,
  onError,
}: JournalMetadataRefreshOptions): void {
  if (typeof metadataCache?.on !== 'function') return;
  const eventRef = metadataCache.on('changed', async (file) => {
    if (!file?.path || String(file.extension).toLowerCase() !== 'md') return;
    try {
      await journalIndex.refreshFile(file.path, getSettings());
    } catch (error) {
      onError(error, file);
    }
  });
  if (eventRef) registerEvent(eventRef);
}
