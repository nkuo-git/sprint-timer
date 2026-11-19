import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { ClockModel } from '../core/clockSync';
import { twoPhoneResult, type RaceResult } from '../core/result';
import { Link, syncRound } from '../net/link';
import { HandheldFinish, type HandheldHandle } from '../ui/HandheldFinish';
import { Btn, C, Chip, s } from '../ui/kit';

/** 雙手機模式：終點手機（B）。和起跑手機同步時鐘、用高速相機抓衝線。 */
export function TwoPhoneFinish({ onBack }: { onBack(): void }) {
  useKeepAwake();
  const hh = useRef<HandheldHandle>(null);
  const link = useRef<Link | null>(null);
  const clock = useRef(new ClockModel());
  const race = useRef<{ id: string; gun?: number; cross?: { t: number; frameInterval: number }; onset?: number | null; sent?: boolean }>({ id: '' });
  const [host, setHost] = useState('192.168.');
  const [connected, setConnected] = useState(false);
  const [sync, setSync] = useState<string>('尚未同步');
  const [syncErr, setSyncErr] = useState<number | null>(null);
  const [gunLocal, setGunLocal] = useState<number | null>(null);
  const [raceNo, setRaceNo] = useState(1);
  // 雙手機模式沒有事先設定距離：在成績畫面選，選過之後同一次計時沿用
  const [distance, setDistance] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<RaceResult | null>(null);

  const finish = () => {
    const r = race.current;
    if (r.gun === undefined || !r.cross || !clock.current.ready) return;
    const res = twoPhoneResult({
      gunOnA: r.gun,
      crossOnB: r.cross.t,
      clock: clock.current,
      frameInterval: r.cross.frameInterval,
      motionOnsetOnA: r.onset ?? undefined,
    });
    setResult(res);
    if (!r.sent) {
      r.sent = true;
      link.current?.sendReliable({ type: 'result', raceId: r.id, raw: res.raw, reaction: res.reaction, falseStart: res.falseStart });
    }
  };

  useEffect(() => {
    const l = new Link(0); // 隨機本機 port
    link.current = l;
    const off = l.on((m) => {
      if (m.type === 'hello') setConnected(true);
      else if (m.type === 'status') {
        if (m.phase === 'marks' && race.current.id !== m.raceId) {
          race.current = { id: m.raceId };
          setResult(null);
          setGunLocal(null);
          setStatus(hh.current?.arm() ? '各就位' : '還沒鎖定終點線，這趟無法計時');
        } else if (m.phase === 'set') setStatus('預備');
      } else if (m.type === 'gun' && m.raceId === race.current.id && race.current.gun === undefined) {
        race.current.gun = m.tGun;
        setGunLocal(clock.current.ready ? clock.current.serverToClient(m.tGun) : PrecisionClock.now());
        setStatus('已鳴槍，計時中');
        finish();
      } else if (m.type === 'reaction' && m.raceId === race.current.id && race.current.onset === undefined) {
        race.current.onset = m.tOnset;
        race.current.sent = false;
        finish();
      }
    });
    return () => {
      off();
      l.close();
    };
  }, []);

  // 連線後每 8 秒同步一次，持續追蹤時鐘漂移
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const loop = async () => {
      while (alive) {
        try {
          const r = await syncRound(link.current!, clock.current);
          setSyncErr(r.errMs);
          setSync(`時鐘差 ${r.offsetMs.toFixed(1)}ms，誤差 ±${r.errMs.toFixed(2)}ms，漂移 ${clock.current.skewPpm.toFixed(1)}ppm`);
        } catch (e: any) {
          setSync(e.message);
        }
        await new Promise((r) => setTimeout(r, 8000));
      }
    };
    loop();
    return () => {
      alive = false;
    };
  }, [connected]);

  const connect = () => {
    link.current!.connect(host.trim());
    link.current!.send({ type: 'hello', role: 'finish', name: 'finish', v: 1 });
  };

  const onRunner = (t: number, frameInterval: number) => {
    const r = race.current;
    if (r.cross) return;
    // 鳴槍前經過終點線的人不算
    if (r.gun !== undefined && clock.current.ready && t <= clock.current.serverToClient(r.gun)) return;
    r.cross = { t, frameInterval };
    finish();
  };

  const onArmed = () => {
    if (race.current.id) link.current?.sendReliable({ type: 'arm', raceId: race.current.id });
  };

  const first = result;
  const note =
    first?.reaction !== undefined
      ? `第 1 位反應時間（參考）：${first.reaction.toFixed(3)} s${first.falseStart ? '　⚠ 搶跑' : ''}`
      : undefined;

  return (
    <HandheldFinish
      ref={hh}
      onBack={onBack}
      mode="two-phone"
      distanceM={distance}
      onDistanceChange={setDistance}
      raceExtra={result ? { reaction: result.reaction, falseStart: result.falseStart } : undefined}
      raceNo={raceNo}
      fps={240}
      startAt={gunLocal}
      status={status}
      resultNote={note}
      chips={<Chip tone="overlay" dot text={syncErr !== null ? `同步 ±${syncErr.toFixed(1)}ms` : connected ? '同步中…' : '未連線'} />}
      onArmed={onArmed}
      onRunner={onRunner}
      onAgain={() => {
        setResult(null);
        setGunLocal(null);
        setRaceNo((n) => n + 1);
        setStatus('');
      }}
      idleControls={(locked) =>
        connected ? (
          <>
            {!locked && status ? <Text style={{ color: C.warn, fontSize: 14 }}>{status}</Text> : null}
            <Text style={s.note}>{locked ? '準備好了。等起點手機按「開始口令」就會自動開始記錄。' : '先鎖定終點線，再請起點手機按「開始口令」。'}{'\n'}{sync}</Text>
          </>
        ) : (
          <View style={[s.row, { gap: 10 }]}>
            <TextInput
              style={[s.input, { flex: 1, textAlign: 'left', minHeight: 56, fontSize: 17 }]}
              value={host}
              onChangeText={setHost}
              placeholder="起跑手機 IP"
              placeholderTextColor={C.faint}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel="起跑手機 IP"
            />
            <Btn title="連線" onPress={connect} style={{ paddingHorizontal: 24 }} />
          </View>
        )
      }
    />
  );
}
