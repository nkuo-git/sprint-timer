import { officialTime } from '../core/physics';
import { sameRunner } from './format';
import { uuid, type RaceInput } from './store';
import type { RaceMode, Runner, StoredResult } from './types';

/** 成績畫面上的一位跑者（FinishSession.results() 的輸出） */
export interface FinishedRunner {
  /** 衝線標記的 id（同一趟裡不變） */
  id: number;
  place: number;
  /** 成績（秒） */
  time: number;
  auto: boolean;
}

/**
 * 一趟比賽在成績畫面上的暫存狀態：這趟的雲端 id、每位跑者標記給誰、距離。
 * 成績畫面每次有變動（補人、微調、標記）就用 toRace() 產生要存的內容；
 * 同一位跑者每次都對應到同一個成績 id，所以重複儲存只會更新，不會多出一筆。
 */
export class RaceDraft {
  readonly id = uuid();
  readonly ranAt: string;
  distanceM: number | null;
  readonly signal?: 'sound' | 'flash';
  private resultIds = new Map<number, string>();
  private runners = new Map<number, Runner>();

  constructor(
    readonly mode: RaceMode,
    opts: { distanceM?: number | null; signal?: 'sound' | 'flash'; ranAt?: Date } = {},
  ) {
    this.distanceM = opts.distanceM ?? null;
    this.signal = opts.signal;
    this.ranAt = (opts.ranAt ?? new Date()).toISOString();
  }

  runner(markId: number): Runner | null {
    return this.runners.get(markId) ?? null;
  }

  /** 標記這位跑者是誰；null = 取消標記。同一個人在一趟裡只能出現一次，後標的會取代前面的。 */
  tag(markId: number, runner: Runner | null) {
    if (!runner) {
      this.runners.delete(markId);
      return;
    }
    for (const [id, r] of this.runners) {
      if (id !== markId && sameRunner(r, runner)) this.runners.delete(id);
    }
    this.runners.set(markId, runner.kind === 'name' ? { kind: 'name', name: runner.name.trim().slice(0, 40) } : runner);
  }

  /**
   * 產生要存的比賽內容。
   * reaction / falseStart：雙手機模式起點手機量到的反應時間，只有一位跑者時才知道是誰的，所以多人時不記。
   */
  toRace(finished: FinishedRunner[], extra: { reaction?: number; falseStart?: boolean } = {}): RaceInput {
    const results: StoredResult[] = finished.map((f) => {
      let id = this.resultIds.get(f.id);
      if (!id) {
        id = uuid();
        this.resultIds.set(f.id, id);
      }
      const r: StoredResult = { id, place: f.place, time: Math.round(f.time * 1000) / 1000, official: officialTime(f.time), auto: f.auto, runner: this.runner(f.id) };
      if (finished.length === 1) {
        if (extra.reaction !== undefined) r.reaction = Math.round(extra.reaction * 1000) / 1000;
        if (extra.falseStart) r.falseStart = true;
      }
      return r;
    });
    return { id: this.id, ranAt: this.ranAt, distanceM: this.distanceM, mode: this.mode, signal: this.signal, results };
  }
}
