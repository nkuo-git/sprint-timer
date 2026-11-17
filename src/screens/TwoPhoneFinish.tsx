import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { ClockModel } from '../core/clockSync';
import type { Crossing } from '../core/finishLine';
import { twoPhoneResult, type RaceResult } from '../core/result';
import { FinishCamera, defaultRegion, type FinishCameraHandle, type FinishRegion, type Telemetry } from '../camera/FinishCamera';
import { Link, syncRound } from '../net/link';
import { RegionControls } from '../ui/RegionControls';
import { Btn, C, Chip, IconBtn, NUM, Segmented, SectionTitle, s } from '../ui/kit';
import { ResultView, type RunRecord } from '../ui/ResultView';

/** 雙手機模式：終點手機（B）。和起跑手機同步時鐘、用高速相機抓衝線。 */
export function TwoPhoneFinish({ onBack }: { onBack(): void }) {
  useKeepAwake();
  const cam = useRef<FinishCameraHandle>(null);
  const link = useRef<Link | null>(null);
  const clock = useRef(new ClockModel());
  const race = useRef<{ id: string; gun?: number; cross?: Crossing; onset?: number | null; sent?: boolean }>({ id: '' });
  const [host, setHost] = useState('192.168.');
  const [connected, setConnected] = useState(false);
  const [sync, setSync] = useState<string>('尚未同步');
  const [syncErr, setSyncErr] = useState<number | null>(null);
  const [gunLocal, setGunLocal] = useState<number | null>(null);
  const [region, setRegion] = useState<FinishRegion>(defaultRegion);
  const [fps, setFps] = useState(240);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [armed, setArmed] = useState(false);
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
          setArmed(false);
          setStatus('各就位：學習背景中（請保持終點線淨空）');
          cam.current?.learnAndArm();
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

  const onCross = (c: Crossing) => {
    race.current.cross = c;
    setArmed(false);
    setStatus(`偵測到衝線（${c.method}，${c.points} 點擬合）`);
    finish();
  };

  const onArmed = () => {
    setArmed(true);
    setStatus('待命中：等待衝線');
    if (race.current.id) link.current?.sendReliable({ type: 'arm', raceId: race.current.id });
  };

  const [adjust, setAdjust] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const lastRace = useRef('');
  const running = gunLocal !== null && !result;

  // 鳴槍後在畫面上跑碼表（只是顯示用，成績以衝線內插為準）
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(PrecisionClock.now() - gunLocal!), 47);
    return () => clearInterval(id);
  }, [running, gunLocal]);

  useEffect(() => {
    if (!result || lastRace.current === race.current.id) return;
    lastRace.current = race.current.id;
    setHistory((h) => [...h, { n: h.length + 1, raw: result.falseStart ? null : result.raw }]);
  }, [result]);

  const timebaseOk = tele ? tele.lag > -0.01 && tele.lag < 0.3 : true;

  const label = running ? '計時中（已收到鳴槍）' : connected ? status || '等待起點鳴槍' : '先連線到起跑手機';
  return (
    <View style={[s.screen, { backgroundColor: '#000' }]}>
      <View style={{ flex: 1 }}>
        <FinishCamera ref={cam} region={region} targetFps={fps} onCross={onCross} onArmed={onArmed} onTelemetry={setTele} />
        <View style={styles.hud} pointerEvents="box-none">
          <IconBtn translucent label="返回" glyph="‹" onPress={onBack} />
          <View style={[s.wrap, { flex: 1, justifyContent: 'flex-end' }]}>
            <Chip tone="overlay" text={tele ? `${tele.fps.toFixed(0)} fps` : `${fps} fps`} />
            <Chip tone="overlay" dot text={syncErr !== null ? `同步 ±${syncErr.toFixed(1)}ms` : connected ? '同步中…' : '未連線'} />
            {armed ? <Chip tone="overlay" text="待命中" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={{ gap: 14 }} style={{ maxHeight: adjust ? 420 : undefined }}>
          <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={{ color: C.dim, fontSize: 14 }}>{label}</Text>
              <Text style={[NUM, { color: running ? C.text : C.dim, fontSize: 48, fontWeight: '700', lineHeight: 52 }]}>{running ? elapsed.toFixed(2) : '0.00'}</Text>
            </View>
            <Text style={{ color: C.dim, fontSize: 13, textAlign: 'right' }}>{tele ? `偵測器：${tele.phase}` : '相機啟動中…'}</Text>
          </View>

          {!timebaseOk ? (
            <Text style={{ color: C.badText, fontSize: 14 }}>⚠ 相機時間基準異常（差 {(tele!.lag * 1000).toFixed(0)}ms），這支手機的結果不可信</Text>
          ) : null}

          {!connected ? (
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
          ) : null}

          <View style={[s.row, { gap: 8 }]}>
            <Btn kind="ghost" title={adjust ? '完成調整' : '調整終點線'} onPress={() => setAdjust(!adjust)} style={{ flex: 1 }} textStyle={{ fontSize: 15 }} />
            <Btn kind="ghost" title="重學背景" onPress={() => cam.current?.learnAndArm()} style={{ flex: 1 }} textStyle={{ fontSize: 15 }} />
          </View>

          {adjust ? (
            <>
              <SectionTitle>相機 fps</SectionTitle>
              <Segmented<number> options={[240, 120, 60]} value={fps} onChange={setFps} fmt={(f) => `${f}fps`} />
              <RegionControls region={region} onChange={setRegion} />
              <Text style={s.note}>{sync}</Text>
              <Text style={s.note}>Android 相機時間來源：{PrecisionClock.cameraTimestampSource()}</Text>
            </>
          ) : (
            <Text style={s.note}>手機架腳架，放在終點線延長線、跑道外側，鏡頭垂直對跑道。</Text>
          )}
        </ScrollView>
      </View>
      {/* 成績蓋在相機上面，相機保持開著，下一趟起點開始時才能馬上學背景 */}
      {result ? (
        <View style={StyleSheet.absoluteFill}>
          <ResultView
        raw={result.raw}
        reaction={result.reaction}
        falseStart={result.falseStart}
        uncertainty={result.uncertainty}
        cameraFps={tele?.fps}
        context="雙手機"
        history={history}
        notes={result.notes}
        onAgain={() => {
          setResult(null);
          setGunLocal(null);
          setStatus('等待起點開始口令');
        }}
        onHome={onBack}
      />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { position: 'absolute', left: 16, right: 16, top: 52, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 28, marginTop: -24 },
});
