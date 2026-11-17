import { ClockModel } from './clockSync';
import { officialTime, soundDelay } from './physics';

export interface RaceResult {
  /** 成績（秒，含反應時間），千分位 */
  raw: number;
  /** 正式成績（進位到百分位） */
  official: number;
  /** 反應時間（秒），有量測才有 */
  reaction?: number;
  falseStart?: boolean;
  /** 誤差上限估計（秒） */
  uncertainty: number;
  notes: string[];
}

/**
 * 雙手機：A（起跑）是時鐘 server，B（終點）是 client。
 * clock.offsetAt(t) = A 時鐘 − B 時鐘。
 */
export function twoPhoneResult(args: {
  gunOnA: number;
  crossOnB: number;
  clock: ClockModel;
  frameInterval: number;
  motionOnsetOnA?: number;
  speakerDistanceM?: number;
  falseStartThreshold?: number;
}): RaceResult {
  const gunOnB = args.clock.serverToClient(args.gunOnA);
  const raw = args.crossOnB - gunOnB;
  const notes: string[] = [];
  let reaction: number | undefined;
  let falseStart: boolean | undefined;
  if (args.motionOnsetOnA !== undefined) {
    // 跑者聽到槍聲的時間 = 鳴槍 + 喇叭到跑者的聲音傳遞時間
    const heard = args.gunOnA + soundDelay(args.speakerDistanceM ?? 1.5);
    reaction = args.motionOnsetOnA - heard;
    falseStart = reaction < (args.falseStartThreshold ?? 0.1);
    if (falseStart) notes.push(reaction < 0 ? '鳴槍前就起動' : '反應時間低於門檻');
  }
  const uncertainty = args.clock.uncertainty + args.frameInterval * 0.25 + 0.0005;
  return { raw, official: officialTime(raw), reaction, falseStart, uncertainty, notes };
}

/**
 * 單手機：手機放終點，自己鳴槍（聲音）或閃光。
 * 聲音模式要扣掉聲音從終點傳到起點的時間，否則跑者等於被多計了 d/c 秒。
 */
export function singlePhoneResult(args: {
  signalAt: number;
  crossAt: number;
  signal: 'sound' | 'flash';
  distanceM: number;
  tempC?: number;
  /** 閃光模式：手電筒實際亮起的延遲（秒），需在設定中校正 */
  torchLatency?: number;
  frameInterval: number;
}): RaceResult {
  const notes: string[] = [];
  let start: number;
  if (args.signal === 'sound') {
    start = args.signalAt + soundDelay(args.distanceM, args.tempC ?? 20);
  } else {
    start = args.signalAt + (args.torchLatency ?? 0);
    notes.push('閃光起跑：視覺反應通常比聽覺慢 30–50ms，成績會比正式比賽略慢');
  }
  const raw = args.crossAt - start;
  const uncertainty = args.frameInterval * 0.25 + 0.002 + (args.signal === 'flash' ? 0.01 : 0);
  return { raw, official: officialTime(raw), uncertainty, notes };
}
