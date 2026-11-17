/**
 * 兩支手機之間的訊息（UDP JSON）。時間一律是送出方的 PrecisionClock 秒數。
 * A = 起跑手機（時鐘 server），B = 終點手機（client）。
 */
export type Msg =
  | { type: 'hello'; role: 'start' | 'finish'; name: string; v: 1 }
  | { type: 'ping'; id: number; t0: number }
  | { type: 'pong'; id: number; t0: number; t1: number; t2: number }
  | { type: 'arm'; raceId: string } // B → A：終點已就緒，可以開始口令
  | { type: 'status'; raceId: string; phase: 'marks' | 'set' | 'aborted' }
  | { type: 'gun'; raceId: string; tGun: number }
  | { type: 'reaction'; raceId: string; tOnset: number | null }
  | { type: 'result'; raceId: string; raw: number; reaction?: number; falseStart?: boolean }
  | { type: 'ack'; of: string; raceId: string };

export function encode(m: Msg): string {
  return JSON.stringify(m);
}

export function decode(s: string): Msg | null {
  try {
    const m = JSON.parse(s);
    return m && typeof m.type === 'string' ? (m as Msg) : null;
  } catch {
    return null;
  }
}
