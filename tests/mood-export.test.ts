import { describe, expect, it } from 'vitest';
import { escapeMoodCsvCell, escapeMoodLabelsCell, serializeMoodCsv, serializeMoodJson } from '../src/mood-export';
import type { MoodMetadata } from '../src/types';

const UTF8_BOM = '\uFEFF';

function metadataWith(entries: MoodMetadata['entries']): MoodMetadata {
  return { schemaVersion: 2, customLabels: [], entries, orphans: {} };
}

function record(score: MoodMetadata['entries'][string]['score'], labels: string[], note?: string) {
  return {
    score,
    labels,
    ...(note === undefined ? {} : { note }),
    recordedAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
  };
}

describe('mood CSV formula-injection guarding', () => {
  it('prefixes an apostrophe only when the caller marks the cell as a string column', () => {
    expect(escapeMoodCsvCell('=1+1')).toBe('=1+1');
    expect(escapeMoodCsvCell('=1+1', { guardFormula: true })).toBe("'=1+1");
    expect(escapeMoodCsvCell('+1+1', { guardFormula: true })).toBe("'+1+1");
    expect(escapeMoodCsvCell('-1+1', { guardFormula: true })).toBe("'-1+1");
    expect(escapeMoodCsvCell('@SUM(1)', { guardFormula: true })).toBe("'@SUM(1)");
    expect(escapeMoodCsvCell('\t=1+1', { guardFormula: true })).toBe("'\t=1+1");
    // A leading CR is guarded first and then CSV-quoted because it is a row break.
    expect(escapeMoodCsvCell('\r=1+1', { guardFormula: true })).toBe('"\'\r=1+1"');
    // Ordinary quoting stays untouched.
    expect(escapeMoodCsvCell('a,b')).toBe('"a,b"');
    expect(escapeMoodCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('guards sourcePath, labels, and note cells but never the numeric score cell', () => {
    const csv = serializeMoodCsv(metadataWith({
      '@evil.md': record(-2, ['@SUM(1)', 'a; b'], '=HYPERLINK("http://evil.example","click")'),
    }));

    expect(csv).toContain([
      "'@evil.md",
      'active',
      '-2',
      "'@SUM(1); a%3B b",
      '"\'=HYPERLINK(""http://evil.example"",""click"")"',
    ].join(','));
    // The score column keeps the legitimate negative sign untouched.
    expect(csv).toContain(',active,-2,');
    expect(csv).not.toContain("'-2");
  });

  it('leaves the JSON export unchanged by the CSV guard', () => {
    const metadata = metadataWith({ '@evil.md': record(-2, ['@SUM(1)'], '=1+1') });
    expect(serializeMoodJson(metadata).startsWith('{')).toBe(true);
    expect(serializeMoodJson(metadata)).toContain('"=1+1"');
  });
});

describe('mood CSV label separator encoding', () => {
  it('keeps a literal separator inside a label distinguishable from two labels', () => {
    expect(escapeMoodLabelsCell(['a; b'])).toBe('a%3B b');
    expect(escapeMoodLabelsCell(['a', 'b'])).toBe('a; b');
    expect(escapeMoodLabelsCell(['100%'])).toBe('100%25');
    expect(escapeMoodLabelsCell(['%3B'])).toBe('%253B');
    expect(escapeMoodLabelsCell(['a; b'])).not.toBe(escapeMoodLabelsCell(['a', 'b']));
  });

  it('serializes the encoded labels cell instead of the raw join', () => {
    const csv = serializeMoodCsv(metadataWith({ 'Daily/a.md': record(1, ['a; b']) }));
    expect(csv).toContain('Daily/a.md,active,1,a%3B b,');
  });
});

describe('mood CSV UTF-8 BOM', () => {
  it('starts the CSV with a UTF-8 BOM so Excel decodes non-ASCII text', () => {
    const csv = serializeMoodCsv(metadataWith({ 'Daily/2026-08-01.md': record(1, ['散步'], '今天很好') }));
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv.slice(UTF8_BOM.length).startsWith('sourcePath,recordStatus,score,labels,note,')).toBe(true);
    expect(csv).toContain('散步');
    // Only the first byte-order mark is present, and every row still ends in CRLF.
    expect(csv.split(UTF8_BOM).length).toBe(2);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
