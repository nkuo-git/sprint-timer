import dgram from 'react-native-udp';
import { ClockModel, estimateOffset, type PingSample } from '../core/clockSync';
import { decode, encode, type Msg } from '../core/protocol';
import { PrecisionClock } from '../../modules/precision-clock';

export const PORT = 47800;

type Listener = (m: Msg, from: { address: string; port: number }) => void;

/**
 * 兩支手機之間的 UDP 連線（同一個 Wi-Fi，或其中一支開熱點）。
 * 為什麼不用藍牙：iOS/Android 跨平台的 BLE「周邊（peripheral）」角色支援很差，
 * 而時鐘同步只需要低且穩定的來回延遲，區網 UDP 比 BLE 好（Wi-Fi rtt ~3–10ms，BLE 連線間隔 7.5–30ms）。
 * 傳輸延遲本身不影響成績，因為同步是用時間戳計算的。
 */
export class Link {
  private sock: ReturnType<typeof dgram.createSocket>;
  private listeners = new Set<Listener>();
  peer: { address: string; port: number } | null = null;

  constructor(port = PORT) {
    this.sock = dgram.createSocket({ type: 'udp4', reusePort: true });
    this.sock.bind(port);
    this.sock.on('message', (data: any, rinfo: { address: string; port: number }) => {
      const tRecv = PrecisionClock.now();
      const m = decode(String(data));
      if (!m) return;
      if (!this.peer) this.peer = { address: rinfo.address, port: rinfo.port };
      // 時鐘 server：收到 ping 立刻回 pong（在這裡處理，盡量減少延遲）
      if (m.type === 'ping') {
        this.sendTo({ type: 'pong', id: m.id, t0: m.t0, t1: tRecv, t2: PrecisionClock.now() }, rinfo);
        return;
      }
      (m as any).__tRecv = tRecv;
      this.listeners.forEach((l) => l(m, rinfo));
    });
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  connect(address: string, port = PORT) {
    this.peer = { address, port };
  }

  private sendTo(m: Msg, to: { address: string; port: number }) {
    const s = encode(m);
    this.sock.send(s, undefined, undefined, to.port, to.address);
  }

  send(m: Msg) {
    if (!this.peer) throw new Error('尚未連線');
    this.sendTo(m, this.peer);
  }

  /** UDP 可能掉封包：重要訊息重送 n 次（接收端用 raceId 去重） */
  sendReliable(m: Msg, times = 4, gapMs = 40) {
    for (let i = 0; i < times; i++) setTimeout(() => this.peer && this.send(m), i * gapMs);
  }

  close() {
    this.sock.close();
  }
}

/**
 * 終點手機（client）執行：對起跑手機 ping n 次，估計 offset 並加入時鐘模型。
 */
export async function syncRound(link: Link, clock: ClockModel, n = 40, gapMs = 25): Promise<{ offsetMs: number; errMs: number }> {
  const samples: PingSample[] = [];
  const pending = new Map<number, number>();
  const base = Math.floor(Math.random() * 1e6);
  const off = link.on((m) => {
    if (m.type !== 'pong' || !pending.has(m.id)) return;
    pending.delete(m.id);
    samples.push({ t0: m.t0, t1: m.t1, t2: m.t2, t3: (m as any).__tRecv });
  });
  for (let i = 0; i < n; i++) {
    const id = base + i;
    const t0 = PrecisionClock.now();
    pending.set(id, t0);
    link.send({ type: 'ping', id, t0 });
    await new Promise((r) => setTimeout(r, gapMs));
  }
  await new Promise((r) => setTimeout(r, 300));
  off();
  if (samples.length < 5) throw new Error(`同步失敗：只收到 ${samples.length}/${n} 個回應`);
  const est = estimateOffset(samples);
  clock.add(est);
  return { offsetMs: est.offset * 1000, errMs: (est.maxRtt / 2) * 1000 };
}
