import * as Speech from 'expo-speech';

export type CommandLang = 'zh' | 'en';

const TEXT = {
  zh: { marks: '各就位', set: '預備' },
  en: { marks: 'On your marks', set: 'Set' },
};

/** 口令用語音合成（時間不需精準，只有槍聲需要精準） */
export function speak(cmd: 'marks' | 'set', lang: CommandLang) {
  Speech.speak(TEXT[lang][cmd], { language: lang === 'zh' ? 'zh-TW' : 'en-US', rate: 0.9 });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等到 PrecisionClock 時間 t（秒），用 setTimeout，不需精準 */
export async function sleepUntil(now: () => number, t: number) {
  const ms = (t - now()) * 1000;
  if (ms > 0) await sleep(ms);
}
