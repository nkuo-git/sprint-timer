import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { ClockModel } from '../core/clockSync';
import type { Crossing } from '../core/finishLine';
import { officialTime } from '../core/physics';
import { twoPhoneResult, type RaceResult } from '../core/result';
import { FinishCamera, defaultRegion, type FinishCameraHandle, type FinishRegion, type Telemetry } from '../camera/FinishCamera';
import { Link, syncRound } from '../net/link';
import { RegionControls } from '../ui/RegionControls';
import { BigTime, Btn, C, Label, Row, s } from '../ui/kit';

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
          setArmed(false);
          setStatus('各就位：學習背景中（請保持終點線淨空）');
          cam.current?.learnAndArm();
        } else if (m.phase === 'set') setStatus('預備');
      } else if (m.type === 'gun' && m.raceId === race.current.id && race.current.gun === undefined) {
        race.current.gun = m.tGun;
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

  const timebaseOk = tele ? tele.lag > -0.01 && tele.lag < 0.3 : true;
  return (
    <View style={s.screen}>
      <View style={{ height: 260 }}>
        <FinishCamera ref={cam} region={region} targetFps={fps} onCross={onCross} onArmed={onArmed} onTelemetry={setTele} />
      </View>
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.title}>終點手機</Text>
        <View style={s.card}>
          <Row>
            <TextInput style={[s.input, { flex: 1, textAlign: 'left' }]} value={host} onChangeText={setHost} placeholder="起跑手機 IP" placeholderTextColor={C.dim} keyboardType="numbers-and-punctuation" />
            <Btn title={connected ? '已連線' : '連線'} onPress={connect} />
          </Row>
          <Label dim>{sync}</Label>
        </View>
        {result ? (
          <View style={s.card}>
            <Label>成績（含反應時間）</Label>
            <BigTime seconds={result.raw} sub={`正式成績 ${officialTime(result.raw).toFixed(2)}　誤差約 ±${(result.uncertainty * 1000).toFixed(1)}ms`} />
            {result.reaction !== undefined ? (
              <Label>
                反應時間（參考）：{result.reaction.toFixed(3)}s {result.falseStart ? '⚠ 搶跑' : ''}
              </Label>
            ) : null}
          </View>
        ) : null}
        <Label>{status}</Label>
        <Label dim>
          {tele ? `實際 ${tele.fps.toFixed(0)}fps・偵測器 ${tele.phase}` : '相機啟動中…'}
          {timebaseOk ? '' : `\n⚠ 相機時間基準異常（差 ${(tele!.lag * 1000).toFixed(0)}ms），這支手機的結果不可信`}
        </Label>
        <Row>
          {[240, 120, 60].map((f) => (
            <Btn key={f} kind={f === fps ? 'primary' : 'ghost'} title={`${f}fps`} onPress={() => setFps(f)} style={{ flex: 1 }} />
          ))}
        </Row>
        <RegionControls region={region} onChange={setRegion} />
        <Btn kind="ghost" title={armed ? '待命中' : '手動待命（測試用）'} onPress={() => cam.current?.learnAndArm()} />
        <Label dim>Android 相機時間來源：{PrecisionClock.cameraTimestampSource()}</Label>
        <Btn kind="ghost" title="返回" onPress={onBack} />
      </ScrollView>
    </View>
  );
}
