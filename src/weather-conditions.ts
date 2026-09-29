import { DEFAULT_DISPLAY_LANGUAGE, DisplayLanguage, getDisplayLanguage, LanguageSettings } from './i18n';

/**
 * Localized weather-condition text.
 *
 * `weather-service.ts` keeps the WMO condition strings in English: they are the
 * canonical label for a code and the value already persisted inside cached
 * snapshots. Everything the UI prints goes through `weatherConditionLabel()`
 * instead, so one snapshot reads in the active display language — the badge
 * tooltip on a calendar cell, the weather-card icon alt text, and the date
 * overlay all share this table.
 */

/** WMO 4677 codes Dayline renders, in the order `weather-service.ts` lists them. */
export const WEATHER_CONDITION_CODES: readonly number[] = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
];

type WeatherConditionTable = {
  /** One label per entry of WEATHER_CONDITION_CODES, in the same order. */
  conditions: readonly string[];
  /** Shown for a code the table does not know; `{code}` is replaced. */
  unknown: string;
};

const WEATHER_CONDITIONS: Record<DisplayLanguage, WeatherConditionTable> = {
  en: {
    conditions: [
      'Clear sky', 'Mainly clear', 'Partly cloudy', 'Overcast',
      'Foggy', 'Depositing rime fog',
      'Light drizzle', 'Moderate drizzle', 'Dense drizzle',
      'Slight rain', 'Moderate rain', 'Heavy rain',
      'Slight snow fall', 'Moderate snow fall', 'Heavy snow fall', 'Snow grains',
      'Slight rain showers', 'Moderate rain showers', 'Violent rain showers',
      'Slight snow showers', 'Heavy snow showers',
      'Thunderstorm', 'Thunderstorm w/ hail', 'Thunderstorm w/ heavy hail',
    ],
    unknown: 'Weather code {code}',
  },
  zh: {
    conditions: [
      '晴', '大致晴朗', '局部多云', '阴',
      '有雾', '雾凇',
      '小毛毛雨', '中等毛毛雨', '浓密毛毛雨',
      '小雨', '中雨', '大雨',
      '小雪', '中雪', '大雪', '米雪',
      '小阵雨', '中等阵雨', '强阵雨',
      '小阵雪', '大阵雪',
      '雷暴', '雷暴伴冰雹', '雷暴伴强冰雹',
    ],
    unknown: '天气代码 {code}',
  },
  'zh-tw': {
    conditions: [
      '晴', '大致晴朗', '局部多雲', '陰',
      '有霧', '霧凇',
      '小毛毛雨', '中等毛毛雨', '濃密毛毛雨',
      '小雨', '中雨', '大雨',
      '小雪', '中雪', '大雪', '米雪',
      '小陣雨', '中等陣雨', '強陣雨',
      '小陣雪', '大陣雪',
      '雷暴', '雷暴伴冰雹', '雷暴伴強冰雹',
    ],
    unknown: '天氣代碼 {code}',
  },
  ja: {
    conditions: [
      '快晴', '晴れ', '一部曇り', '曇り',
      '霧', '着氷性の霧',
      '弱い霧雨', '霧雨', '強い霧雨',
      '弱い雨', '雨', '強い雨',
      '弱い雪', '雪', '強い雪', '雪あられ',
      '弱いにわか雨', 'にわか雨', '激しいにわか雨',
      '弱いにわか雪', '強いにわか雪',
      '雷雨', '雹を伴う雷雨', '激しい雹を伴う雷雨',
    ],
    unknown: '天気コード {code}',
  },
  ko: {
    conditions: [
      '맑음', '대체로 맑음', '부분적으로 흐림', '흐림',
      '안개', '착빙성 안개',
      '약한 이슬비', '이슬비', '강한 이슬비',
      '약한 비', '비', '강한 비',
      '약한 눈', '눈', '강한 눈', '싸락눈',
      '약한 소나기', '소나기', '강한 소나기',
      '약한 눈 소나기', '강한 눈 소나기',
      '뇌우', '우박을 동반한 뇌우', '강한 우박을 동반한 뇌우',
    ],
    unknown: '날씨 코드 {code}',
  },
  fr: {
    conditions: [
      'Ciel dégagé', 'Plutôt dégagé', 'Partiellement nuageux', 'Couvert',
      'Brouillard', 'Brouillard givrant',
      'Bruine légère', 'Bruine modérée', 'Bruine dense',
      'Pluie faible', 'Pluie modérée', 'Pluie forte',
      'Neige faible', 'Neige modérée', 'Neige forte', 'Grains de neige',
      'Averses faibles', 'Averses modérées', 'Averses violentes',
      'Averses de neige faibles', 'Averses de neige fortes',
      'Orage', 'Orage avec grêle', 'Orage avec forte grêle',
    ],
    unknown: 'Code météo {code}',
  },
  de: {
    conditions: [
      'Klarer Himmel', 'Überwiegend klar', 'Teils bewölkt', 'Bedeckt',
      'Neblig', 'Gefrierender Nebel',
      'Leichter Nieselregen', 'Mäßiger Nieselregen', 'Dichter Nieselregen',
      'Leichter Regen', 'Mäßiger Regen', 'Starker Regen',
      'Leichter Schneefall', 'Mäßiger Schneefall', 'Starker Schneefall', 'Schneegriesel',
      'Leichte Regenschauer', 'Mäßige Regenschauer', 'Heftige Regenschauer',
      'Leichte Schneeschauer', 'Starke Schneeschauer',
      'Gewitter', 'Gewitter mit Hagel', 'Gewitter mit starkem Hagel',
    ],
    unknown: 'Wettercode {code}',
  },
  es: {
    conditions: [
      'Cielo despejado', 'Mayormente despejado', 'Parcialmente nublado', 'Cubierto',
      'Niebla', 'Niebla helada',
      'Llovizna ligera', 'Llovizna moderada', 'Llovizna densa',
      'Lluvia ligera', 'Lluvia moderada', 'Lluvia intensa',
      'Nevada ligera', 'Nevada moderada', 'Nevada intensa', 'Granos de nieve',
      'Chubascos ligeros', 'Chubascos moderados', 'Chubascos violentos',
      'Chubascos de nieve ligeros', 'Chubascos de nieve intensos',
      'Tormenta', 'Tormenta con granizo', 'Tormenta con granizo fuerte',
    ],
    unknown: 'Código meteorológico {code}',
  },
  ru: {
    conditions: [
      'Ясно', 'Преимущественно ясно', 'Переменная облачность', 'Пасмурно',
      'Туман', 'Изморозь',
      'Слабая морось', 'Умеренная морось', 'Сильная морось',
      'Небольшой дождь', 'Умеренный дождь', 'Сильный дождь',
      'Небольшой снег', 'Умеренный снег', 'Сильный снег', 'Снежные зёрна',
      'Небольшие ливни', 'Умеренные ливни', 'Сильные ливни',
      'Небольшие снежные ливни', 'Сильные снежные ливни',
      'Гроза', 'Гроза с градом', 'Гроза с сильным градом',
    ],
    unknown: 'Код погоды {code}',
  },
};

type SnapshotLike = { weatherCode?: unknown; condition?: unknown } | null | undefined;

/**
 * Condition text for a weather snapshot in the active display language.
 *
 * A snapshot from before multi-language support carries only the English
 * `condition` string, which is returned unchanged; one with a numeric
 * `weatherCode` renders from the table, and a code outside it degrades to the
 * localized "Weather code N" label instead of throwing.
 */
export function weatherConditionLabel(snapshot: SnapshotLike, settings: LanguageSettings = {}): string {
  const table = WEATHER_CONDITIONS[getDisplayLanguage(settings)] || WEATHER_CONDITIONS[DEFAULT_DISPLAY_LANGUAGE];
  const code = Number(snapshot?.weatherCode);
  if (Number.isFinite(code)) {
    const index = WEATHER_CONDITION_CODES.indexOf(code);
    if (index >= 0) return table.conditions[index];
    return table.unknown.replace('{code}', String(code));
  }
  return String(snapshot?.condition || '');
}
