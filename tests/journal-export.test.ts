import { describe, expect, it } from 'vitest';
import { saveDaylineExport } from '../src/journal-export';

describe('Dayline export storage', () => {
  it('chooses a collision-safe vault path', async () => {
    const files = new Set(['Dayline Exports/report.json']);
    const created: string[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => files.has(path) ? {} : undefined,
        createFolder: async () => undefined,
        create: async (path: string) => { files.add(path); created.push(path); },
      },
    };
    await expect(saveDaylineExport(app, '{}', 'report.json')).resolves.toBe('Dayline Exports/report-2.json');
    expect(created).toEqual(['Dayline Exports/report-2.json']);
  });
});
