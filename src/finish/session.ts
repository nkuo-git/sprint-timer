import { officialTime } from '../core/physics';
import { grayToPngDataUri } from '../core/png';
import { StripRecorder } from '../core/stripRecorder';
import type { FinishEvent, Thumb } from '../core/multiFinish';

export type LineInfo = Extract<FinishEvent, { type: 'line' }>;

/** 一位跑者的衝線標記。auto = 系統自動偵測；手動新增或調整過的 auto = false */
export interface RunnerMark {
  id: number;
  /** 衝線時間（秒，本機時鐘） */
  t: number;
  auto: boolean;
  /** 在終點攝影條上的列範圍（0 = 最上面）。手動新增的沒有 */
  rowLo?: number;
  rowHi?: number;
  /** 衝線瞬間截圖（data URI）與終點線在截圖上的位置（0–1） */
  thumbUri?: string;
  thumbLine?: { xTop: number; xBot: number };
  name?: string;
}

export interface RunnerResult {
  id: number;
  place: number;
  name?: string;
  /** 成績（秒，千分位） */
  time: number;
  /** 正式成績（進位到百分位） */
  official: number;
  auto: boolean;
}

/**
 * 終點這一側一趟比賽的狀態（純邏輯，不含 React）：
 * 接收相機引擎的事件，累積終點攝影條與每位跑者的衝線標記，支援手動新增、調整、刪除。
 */
export class FinishSession {
  line: LineInfo | null = null;
  phase: 'idle' | 'aim' | 'armed' = 'idle';
  direction: 0 | 1 | -1 = 0;
  marks: RunnerMark[] = [];
  readonly strip = new StripRecorder();
  private manualId = 100000;

  /** 開始新的一趟（保留終點線鎖定） */
  reset() {
    this.marks = [];
    this.strip.reset();
    this.direction = 0;
  }

  /** 把 MultiFinishCamera 的 onEvent 接到這裡。回傳 true 表示畫面需要更新 */
  handle(e: FinishEvent): boolean {
    switch (e.type) {
      case 'line':
        this.line = e.found ? e : null;
        if (!e.found) this.phase = 'idle';
        else if (this.phase === 'idle') this.phase = 'aim';
        return true;
      case 'armed':
        this.phase = 'armed';
        return true;
      case 'direction':
        this.direction = e.direction;
        return true;
      case 'strip':
        this.strip.append(e);
        return true;
      case 'runner':
        this.marks.push({
          id: e.id,
          t: e.t,
          auto: true,
          rowLo: e.rowLo,
          rowHi: e.rowHi,
          ...thumbInfo(e.thumb),
        });
        this.sort();
        return true;
    }
  }

  stopped() {
    if (this.phase === 'armed') this.phase = 'aim';
  }

  private sort() {
    this.marks.sort((a, b) => a.t - b.t);
  }

  /** 在終點攝影條上手動補一位跑者（例如被前面的人擋住） */
  addManual(t: number, name?: string): RunnerMark {
    const m: RunnerMark = { id: this.manualId++, t, auto: false, name };
    this.marks.push(m);
    this.sort();
    return m;
  }

  /** 手動調整某位跑者的衝線時間（在條上拖曳標記） */
  moveMark(id: number, t: number) {
    const m = this.marks.find((x) => x.id === id);
    if (!m) return;
    m.t = t;
    m.auto = false;
    this.sort();
  }

  removeMark(id: number) {
    this.marks = this.marks.filter((x) => x.id !== id);
  }

  rename(id: number, name: string) {
    const m = this.marks.find((x) => x.id === id);
    if (m) m.name = name;
  }

  /**
   * 算成績。startAt = 起跑時刻（本機時鐘）：
   *  - 雙手機：clock.serverToClient(起跑手機的鳴槍時間)
   *  - 單手機槍聲：鳴槍時間 + soundDelay(距離, 氣溫)
   * 早於起跑的標記（待命時有人走過）不列入。
   */
  results(startAt: number): RunnerResult[] {
    return this.marks
      .filter((m) => m.t > startAt)
      .map((m, i) => ({ id: m.id, place: i + 1, name: m.name, time: m.t - startAt, official: officialTime(m.t - startAt), auto: m.auto }));
  }
}

function thumbInfo(th: Thumb | null): Pick<RunnerMark, 'thumbUri' | 'thumbLine'> {
  if (!th) return {};
  return { thumbUri: grayToPngDataUri(th.w, th.h, th.data), thumbLine: { xTop: th.lineXTop / th.w, xBot: th.lineXBot / th.w } };
}
