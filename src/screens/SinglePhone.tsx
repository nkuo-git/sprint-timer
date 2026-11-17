import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import type { Crossing } from '../core/finishLine';
import { officialTime, soundDelay } from '../core/physics';
import { singlePhoneResult, type RaceResult } from '../core/result';
import { defaultStartSequence, planStart } from '../core/startSequence';
import { FinishCamera, defaultRegion, type FinishCameraHandle, type FinishRegion, type Telemetry } from '../camera/FinishCamera';
import { RegionControls } from '../ui/RegionControls';
import { BigTime, Btn, Label, NumField, Row, s } from '../ui/kit';
import { sleep, sleepUntil, speak, type CommandLang } from './commands';

/**
 * 單手機模式：手機放在終點，自己發口令與起跑訊號，同時用相機抓衝線。
 * 聲音（預設）：扣除聲音從終點傳到起點的時間（距離 ÷ 音速）。
 * 閃光（選用）：手電筒閃一下；光速可忽略，但手電筒延遲未校正，且視覺反應較慢。
 */
export function SinglePhone({ onBack }: { onBack(): void }) {
  useKeepAwake();
  const cam = useRef<FinishCameraHandle>(null);
  const run = useRef<{ signalAt?: number; cross?: Crossing; signal: 'sound' | 'flash' } | null>(null);
  const [signal, setSignal] = useState<'sound' | 'flash'>('sound');
  const [distance, setDistance] = useState(100);
  const [tempC, setTempC] = useState(20);
  const [lang, setLang] = useState<CommandLang>('zh');
  const [region, setRegion] = useState<FinishRegion>(defaultRegion);
  const [fps, setFps] = useState(240);
  const [torch, setTorch] = useState(false);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RaceResult | null>(null);

  useEffect(() => {
    PrecisionClock.prepareAudio().catch((e) => setStatus(`音訊初始化失敗：${e.message}`));
  }, []);

  const finish = () => {
    const r = run.current;
    if (!r || r.signalAt === undefined || !r.cross) return;
    setResult(
      singlePhoneResult({ signalAt: r.signalAt, crossAt: r.cross.t, signal: r.signal, distanceM: distance, tempC, frameInterval: r.cross.frameInterval }),
    );
    setBusy(false);
  };

  const start = async () => {
    const now = PrecisionClock.now;
    setBusy(true);
    setResult(null);
    run.current = { signal };
    const plan = planStart(defaultStartSequence);
    const t0 = now();
    // 背景學習：此時跑者在起點，終點線是空的
    cam.current?.learnAndArm();
    setStatus('學習背景中（終點線請淨空）');
    await sleepUntil(now, t0 + plan.marks);
    setStatus('各就位');
    speak('marks', lang);
    await sleepUntil(now, t0 + plan.set);
    setStatus('預備');
    speak('set', lang);
    if (signal === 'sound') {
      const gun = await PrecisionClock.playGunAt(t0 + plan.gun);
      run.current.signalAt = gun.emittedAt;
    } else {
      await sleepUntil(now, t0 + plan.gun);
      run.current.signalAt = now();
      setTorch(true);
      sleep(400).then(() => setTorch(false));
    }
    setStatus('計時中');
    finish();
  };

  const onCross = (c: Crossing) => {
    if (!run.current) return;
    run.current.cross = c;
    setStatus(`偵測到衝線（${c.method}）`);
    finish();
  };

  return (
    <View style={s.screen}>
      <View style={{ height: 260 }}>
        <FinishCamera ref={cam} region={region} targetFps={fps} torch={torch} onCross={onCross} onTelemetry={setTele} />
      </View>
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.title}>單手機模式</Text>
        {result ? (
          <View style={s.card}>
            <Label>成績（含反應時間）</Label>
            <BigTime seconds={result.raw} sub={`正式成績 ${officialTime(result.raw).toFixed(2)}　誤差約 ±${(result.uncertainty * 1000).toFixed(1)}ms`} />
            {result.notes.map((n) => (
              <Label dim key={n}>
                {n}
              </Label>
            ))}
          </View>
        ) : null}
        <Btn title={busy ? '進行中…' : '開始'} onPress={start} disabled={busy} />
        <Btn kind="ghost" title="取消" onPress={() => { cam.current?.stop(); run.current = null; setBusy(false); setStatus('已取消'); }} />
        <Label>{status}</Label>
        <View style={s.card}>
          <Row>
            <Label>起跑訊號：</Label>
            <Btn kind={signal === 'sound' ? 'primary' : 'ghost'} title="槍聲（建議）" onPress={() => setSignal('sound')} />
            <Btn kind={signal === 'flash' ? 'primary' : 'ghost'} title="閃光" onPress={() => setSignal('flash')} />
          </Row>
          <NumField label="起點到這支手機的距離" value={distance} onChange={setDistance} unit="公尺" />
          {signal === 'sound' ? (
            <>
              <NumField label="氣溫" value={tempC} onChange={setTempC} unit="°C" />
              <Label dim>聲音延遲補償：{(soundDelay(distance, tempC) * 1000).toFixed(1)}ms</Label>
            </>
          ) : (
            <Label dim>閃光模式：手機背面需朝向起點，跑者才看得到；成績會比聽槍聲起跑慢一點。</Label>
          )}
          <Row>
            <Label>口令語言：</Label>
            <Btn kind="ghost" title={lang === 'zh' ? '中文' : 'English'} onPress={() => setLang(lang === 'zh' ? 'en' : 'zh')} />
          </Row>
        </View>
        <Label dim>{tele ? `實際 ${tele.fps.toFixed(0)}fps・偵測器 ${tele.phase}` : '相機啟動中…'}</Label>
        <Row>
          {[240, 120, 60].map((f) => (
            <Btn key={f} kind={f === fps ? 'primary' : 'ghost'} title={`${f}fps`} onPress={() => setFps(f)} style={{ flex: 1 }} />
          ))}
        </Row>
        <RegionControls region={region} onChange={setRegion} />
        <Btn kind="ghost" title="返回" onPress={onBack} />
      </ScrollView>
    </View>
  );
}
