import { describe, expect, it } from 'vitest';
import { filterMoodLabelsForScore, MOOD_LABELS, MOOD_LEVELS, MOOD_LABEL_GROUPS, moodLabelsForScore, moveMoodScore } from '../src/mood';

describe('mood picker choices', () => {
  it('provides five ordered levels and optional labels', () => {
    expect(MOOD_LEVELS.map((level) => level.score)).toEqual([-2, -1, 0, 1, 2]);
    expect(MOOD_LEVELS.map((level) => level.color)).toEqual([
      '#7652c7', '#4d6fb8', '#55b6c9', '#f0b34f', '#ee6a54',
    ]);
    expect(MOOD_LEVELS.every((level) => !('icon' in level))).toBe(true);
    expect(MOOD_LABELS.map((label) => label.id)).toContain('calm');
    expect(MOOD_LABELS.map((label) => label.id)).toContain('grateful');
  });

  it('moves by keyboard direction and clamps at both ends', () => {
    expect(moveMoodScore(null, 1)).toBe(2);
    expect(moveMoodScore(2, 1)).toBe(2);
    expect(moveMoodScore(-2, -1)).toBe(-2);
    expect(moveMoodScore(0, 1)).toBe(1);
  });

  it('narrows feeling labels according to the selected mood level', () => {
    const low = moodLabelsForScore(-2).map((label) => label.id);
    const neutral = moodLabelsForScore(0).map((label) => label.id);
    const high = moodLabelsForScore(2).map((label) => label.id);

    expect(low).toEqual(MOOD_LABEL_GROUPS[-2]);
    expect(neutral).toEqual(MOOD_LABEL_GROUPS[0]);
    expect(high).toEqual(MOOD_LABEL_GROUPS[2]);
    expect(low).not.toEqual(neutral);
    expect(neutral).not.toEqual(high);
    expect(new Set([...low, ...neutral, ...high]).size).toBeGreaterThan(neutral.length);
  });

  it('filters labels when a score changes', () => {
    expect(filterMoodLabelsForScore(-2, ['joyful', 'sad', 'sad'])).toEqual(['sad']);
  });
});
