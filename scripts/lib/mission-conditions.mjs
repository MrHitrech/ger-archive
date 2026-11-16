// These mission condition codes were cross-checked against bounded GER reward tables.
// They are not indexes into game_text.tr2. Unknown codes must remain unclassified.
export const MISSION_CONDITIONS = {
  0: { method: 'mission_reward', en: 'Automatic', ru: 'Основная награда за завершение миссии' },
  2: { method: 'bonus_reward', en: 'Clear under 3 min.', ru: 'Завершить менее чем за 3 минуты' },
  3: { method: 'bonus_reward', en: 'Clear under 5 min.', ru: 'Завершить менее чем за 5 минут' },
  4: { method: 'bonus_reward', en: 'Clear under 10 min.', ru: 'Завершить менее чем за 10 минут' },
  5: {
    method: 'bonus_reward',
    en: 'Clear with 30+ Endurance',
    ru: 'Завершить с выносливостью 30+ (Endurance)',
  },
};
export const CONDITIONAL_REWARDS_DECODER = 'ger-mission-rewards-v2';
export const RUSSIAN_MISSION_NAME_CODEC = 'ger-ru-mission-name-v1';
export function decodeRussianMissionName(value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f\ufffd]/.test(value))
    throw new Error('Unreadable Russian mission name');
  return value;
}
