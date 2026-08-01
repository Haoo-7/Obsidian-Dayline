export type MoodScore = -2 | -1 | 0 | 1 | 2;

export const MOOD_LEVELS = [
  { score: -2 as MoodScore, labelKey: 'veryLow', color: '#d84b76' },
  { score: -1 as MoodScore, labelKey: 'low', color: '#e68a3b' },
  { score: 0 as MoodScore, labelKey: 'neutral', color: '#d9bd4c' },
  { score: 1 as MoodScore, labelKey: 'good', color: '#56a86a' },
  { score: 2 as MoodScore, labelKey: 'veryGood', color: '#4b93d1' },
];

export const MOOD_LABELS = [
  { id: 'calm', label: 'Calm' },
  { id: 'grateful', label: 'Grateful' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'tired', label: 'Tired' },
  { id: 'energized', label: 'Energized' },
  { id: 'hopeful', label: 'Hopeful' },
  { id: 'sad', label: 'Sad' },
  { id: 'focused', label: 'Focused' },
  { id: 'overwhelmed', label: 'Overwhelmed' },
  { id: 'lonely', label: 'Lonely' },
  { id: 'frustrated', label: 'Frustrated' },
  { id: 'thoughtful', label: 'Thoughtful' },
  { id: 'content', label: 'Content' },
  { id: 'joyful', label: 'Joyful' },
  { id: 'proud', label: 'Proud' },
  { id: 'inspired', label: 'Inspired' },
];

// Apple Journal-style context: the feeling choices narrow with the selected
// intensity instead of showing the same labels for every color.
export const MOOD_LABEL_GROUPS: Record<MoodScore, string[]> = {
  [-2]: ['sad', 'anxious', 'overwhelmed', 'lonely'],
  [-1]: ['tired', 'frustrated', 'anxious', 'sad'],
  [0]: ['calm', 'thoughtful', 'content', 'focused'],
  [1]: ['grateful', 'hopeful', 'energized', 'focused'],
  [2]: ['joyful', 'proud', 'inspired', 'grateful', 'energized'],
};

export function moodLabelsForScore(score: MoodScore | null): typeof MOOD_LABELS {
  const ids = score === null ? MOOD_LABELS.map((label) => label.id) : MOOD_LABEL_GROUPS[score];
  return ids
    .map((id) => MOOD_LABELS.find((label) => label.id === id))
    .filter((label): label is (typeof MOOD_LABELS)[number] => Boolean(label));
}

export function moveMoodScore(score: MoodScore | null, direction: -1 | 1): MoodScore {
  const current = score === null ? 2 : score;
  const index = MOOD_LEVELS.findIndex((level) => level.score === current);
  return MOOD_LEVELS[Math.max(0, Math.min(MOOD_LEVELS.length - 1, index + direction))].score;
}

export function getMoodColor(score: MoodScore | number | undefined): string {
  return MOOD_LEVELS.find((level) => level.score === score)?.color ?? 'var(--background-modifier-border)';
}
