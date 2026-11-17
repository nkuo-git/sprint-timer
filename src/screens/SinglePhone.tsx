import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import type { Crossing } from '../core/finishLine';
import { soundDelay } from '../core/physics';
import { singlePhoneResult, type RaceResult } from '../core/result';
import { defaultStartSequence, planStart } from '../core/startSequence';
import { FinishCamera, defaultRegion, type FinishCameraHandle, type FinishRegion, type Telemetry } from '../camera/FinishCamera';
import { RegionControls } from '../ui/RegionControls';
import { BigStepper, Btn, C, ChoiceCard, Chip, Header, IconBtn, NUM, NumField, Segmented, SectionTitle, s } from '../ui/kit';
import { ResultView, type RunRecord } from '../ui/ResultView';
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

  const [step, setStep] = useState<'setup' | 'camera'>('setup');
  const [custom, setCustom] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const counted = useRef<RaceResult | null>(null);

  useEffect(() => {
    if (!result || counted.current === result) return;
    counted.current = result;
    setHistory((h) => [...h, { n: h.length + 1, raw: result.raw }]);
  }, [result]);

  const compMs = signal === 'sound' ? soundDelay(distance, tempC) : 0;
  const context = `${distance}m · 單手機 · ${signal === 'sound' ? '槍聲' : '閃光'}`;

  if (result) {
    return (
      <ResultView
        raw={result.raw}
        uncertainty={result.uncertainty}
        cameraFps={tele?.fps}
        context={context}
        history={history}
        notes={result.notes}
        onAgain={() => {
          setResult(null);
          setStatus('');
        }}
        onHome={onBack}
      />
    );
  }

  if (step === 'setup') {
    return (
      <View style={s.screen}>
        <ScrollView contentContainerStyle={[s.pad, { flexGrow: 1 }]}>
          <Header onBack={onBack} kicker="單手機 · 放在終點" title="起跑設定" />

          <View style={{ gap: 10 }}>
            <SectionTitle>距離</SectionTitle>
            <Segmented<string>
              options={['60', '100', '200', '自訂']}
              value={custom ? '自訂' : String(distance)}
              onChange={(v) => {
                if (v === '自訂') setCustom(true);
                else {
                  setCustom(false);
                  setDistance(Number(v));
                }
              }}
              fmt={(v) => (v === '自訂' ? v : `${v}m`)}
            />
            {custom ? <NumField label="起點到這支手機的距離" value={distance} onChange={setDistance} unit="公尺" /> : null}
          </View>

          {signal === 'sound' ? (
            <View style={{ gap: 10 }}>
              <SectionTitle>氣溫（用來算音速）</SectionTitle>
              <BigStepper label="氣溫" value={tempC} unit="°C" min={-10} max={45} onChange={setTempC} />
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            <SectionTitle>起跑訊號</SectionTitle>
            <View style={[s.row, { gap: 10, alignItems: 'stretch' }]}>
              <ChoiceCard title="槍聲" desc="建議。自動扣除聲音傳到起點的時間" selected={signal === 'sound'} onPress={() => setSignal('sound')} />
              <ChoiceCard title="閃光" desc="備用。手機背面要朝向跑者" selected={signal === 'flash'} onPress={() => setSignal('flash')} />
            </View>
          </View>

          <View style={[s.row, { backgroundColor: C.infoBg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, justifyContent: 'space-between' }]}>
            <Text style={{ color: '#C5DFF7', fontSize: 15 }}>聲音延遲補償</Text>
            <Text style={[NUM, { color: C.infoText, fontSize: 22, fontWeight: '700' }]}>{signal === 'sound' ? `− ${compMs.toFixed(3)} s` : '0.000 s'}</Text>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle>口令語言</SectionTitle>
            <Segmented<CommandLang> options={['zh', 'en']} value={lang} onChange={setLang} fmt={(l) => (l === 'zh' ? '中文' : 'English')} />
          </View>

          <Text style={s.note}>
            {signal === 'sound'
              ? '100 公尺外手機喇叭可能聽不清楚，可接有線喇叭。藍牙喇叭延遲不固定，不能用。'
              : '閃光模式：手電筒點亮延遲未校正，且看光起跑比聽槍聲慢一點，只建議當備用。'}
          </Text>

          <View style={{ flex: 1 }} />
          <Btn big title="下一步：架好相機" onPress={() => setStep('camera')} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.screen, { backgroundColor: '#000' }]}>
      <View style={{ flex: 1 }}>
        <FinishCamera ref={cam} region={region} targetFps={fps} torch={torch} onCross={onCross} onTelemetry={setTele} />
        <View style={styles.hud} pointerEvents="box-none">
          <IconBtn translucent label="回到設定" glyph="‹" onPress={() => !busy && setStep('setup')} />
          <View style={[s.wrap, { flex: 1, justifyContent: 'flex-end' }]}>
            <Chip tone="overlay" text={tele ? `${tele.fps.toFixed(0)} fps` : `${fps} fps`} />
            <Chip tone="overlay" text={context} />
          </View>
        </View>
      </View>
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={{ gap: 14 }} style={{ maxHeight: adjust ? 420 : undefined }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: busy ? C.text : C.dim, fontSize: 20, fontWeight: '700', flex: 1 }}>{status || '架好手機後按開始'}</Text>
            <Text style={{ color: C.dim, fontSize: 13 }}>{tele ? `偵測器：${tele.phase}` : '相機啟動中…'}</Text>
          </View>
          {busy ? (
            <Btn
              big
              kind="danger"
              title="取消這趟"
              onPress={() => {
                cam.current?.stop();
                run.current = null;
                setBusy(false);
                setStatus('已取消');
              }}
            />
          ) : (
            <Btn big title="開始口令" onPress={start} />
          )}
          <View style={[s.row, { gap: 8 }]}>
            <Btn kind="ghost" title={adjust ? '完成調整' : '調整終點線'} onPress={() => setAdjust(!adjust)} style={{ flex: 1 }} textStyle={{ fontSize: 15 }} />
          </View>
          {adjust ? (
            <>
              <SectionTitle>相機 fps</SectionTitle>
              <Segmented<number> options={[240, 120, 60]} value={fps} onChange={setFps} fmt={(f) => `${f}fps`} />
              <RegionControls region={region} onChange={setRegion} />
            </>
          ) : (
            <Text style={s.note}>手機架腳架，放在終點線延長線、跑道外側，鏡頭垂直對跑道。開始後會先學習背景，終點線請淨空。</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { position: 'absolute', left: 16, right: 16, top: 52, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 28, marginTop: -24 },
});
