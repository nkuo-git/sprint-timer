import { useKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { soundDelay } from '../core/physics';
import { defaultStartSequence, planStart } from '../core/startSequence';
import { HandheldFinish, type HandheldHandle } from '../ui/HandheldFinish';
import { BigStepper, Btn, C, ChoiceCard, Header, NUM, NumField, Segmented, SectionTitle, s } from '../ui/kit';
import { sleep, sleepUntil, speak, type CommandLang } from './commands';

/**
 * 單手機模式：手機放在終點，自己發口令與起跑訊號，同時用相機抓衝線。
 * 聲音（預設）：扣除聲音從終點傳到起點的時間（距離 ÷ 音速）。
 * 閃光（選用）：手電筒閃一下；光速可忽略，但手電筒延遲未校正，且視覺反應較慢。
 */
export function SinglePhone({ onBack }: { onBack(): void }) {
  useKeepAwake();
  const hh = useRef<HandheldHandle>(null);
  const run = useRef<object | null>(null);
  const [signal, setSignal] = useState<'sound' | 'flash'>('sound');
  const [distance, setDistance] = useState(100);
  const [tempC, setTempC] = useState(20);
  const [lang, setLang] = useState<CommandLang>('zh');
  const [torch, setTorch] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [raceNo, setRaceNo] = useState(1);

  useEffect(() => {
    PrecisionClock.prepareAudio().catch((e) => setStatus(`音訊初始化失敗：${e.message}`));
  }, []);

  const start = async () => {
    const now = PrecisionClock.now;
    if (!hh.current?.arm()) {
      setStatus('先點一下畫面上的終點線');
      return;
    }
    const mine = {};
    run.current = mine;
    setBusy(true);
    setStartAt(null);
    const plan = planStart(defaultStartSequence);
    const t0 = now();
    // 背景學習在 arm() 時進行：此時跑者在起點，終點線是空的
    setStatus('準備中');
    await sleepUntil(now, t0 + plan.marks);
    if (run.current !== mine) return;
    setStatus('各就位');
    speak('marks', lang);
    await sleepUntil(now, t0 + plan.set);
    if (run.current !== mine) return;
    setStatus('預備');
    speak('set', lang);
    let signalAt: number;
    if (signal === 'sound') {
      const gun = await PrecisionClock.playGunAt(t0 + plan.gun);
      signalAt = gun.emittedAt + soundDelay(distance, tempC);
    } else {
      await sleepUntil(now, t0 + plan.gun);
      if (run.current !== mine) return;
      signalAt = now();
      setTorch(true);
      sleep(400).then(() => setTorch(false));
    }
    if (run.current !== mine) return;
    setStartAt(signalAt);
  };

  const cancel = () => {
    run.current = null;
    hh.current?.stop();
    setBusy(false);
    setStartAt(null);
    setStatus('');
  };

  const [step, setStep] = useState<'setup' | 'camera'>('setup');
  const [custom, setCustom] = useState(false);
  const compMs = signal === 'sound' ? soundDelay(distance, tempC) : 0;
  const context = `${distance}m · 單手機 · ${signal === 'sound' ? '槍聲' : '閃光'}`;

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
    <HandheldFinish
      ref={hh}
      onBack={() => {
        cancel();
        setStep('setup');
      }}
      context={context}
      raceNo={raceNo}
      fps={240}
      torch={torch}
      startAt={startAt}
      status={status}
      resultNote={signal === 'flash' ? '閃光起跑：看光起跑通常比聽槍聲慢 30–50ms，成績會略慢。' : `已扣除聲音傳到起點的時間 ${compMs.toFixed(3)} s。`}
      onAgain={() => {
        setBusy(false);
        setStartAt(null);
        setStatus('');
        setRaceNo((n) => n + 1);
      }}
      waitControls={<Btn big kind="danger" title="取消這趟" onPress={cancel} />}
      idleControls={(locked) => (
        <>
          {status && !busy ? <Text style={{ color: C.warn, fontSize: 14 }}>{status}</Text> : null}
          <Btn big title="開始口令" onPress={start} disabled={!locked} />
        </>
      )}
    />
  );
}
