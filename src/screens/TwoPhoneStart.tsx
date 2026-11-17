import { useKeepAwake } from 'expo-keep-awake';
import * as Network from 'expo-network';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { MotionOnsetDetector, defaultMotionConfig } from '../core/reaction';
import { defaultStartSequence, planStart } from '../core/startSequence';
import { StartCamera } from '../camera/StartCamera';
import { Link } from '../net/link';
import { Btn, C, Chip, Header, IconBtn, NUM, NumField, Segmented, SectionTitle, Stat, s } from '../ui/kit';
import { ResultView, type RunRecord } from '../ui/ResultView';
import { speak, sleepUntil, type CommandLang } from './commands';

type Phase = 'idle' | 'marks' | 'set' | 'gun' | 'done';

/** 雙手機模式：起跑手機（A）。發口令、鳴槍、（選用）用相機量反應時間。也是時鐘同步的 server。 */
export function TwoPhoneStart({ onBack }: { onBack(): void }) {
  useKeepAwake();
  const link = useRef<Link | null>(null);
  const motion = useRef(new MotionOnsetDetector());
  const reported = useRef(false);
  const race = useRef<{ id: string; set: number; gun?: number; watchFrom: number } | null>(null);
  const [ip, setIp] = useState('…');
  const [peer, setPeer] = useState<string | null>(null);
  const [finishReady, setFinishReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [lang, setLang] = useState<CommandLang>('zh');
  const [useCam, setUseCam] = useState(true);
  const [speakerDist, setSpeakerDist] = useState(defaultMotionConfig.speakerDistanceM);
  const [setMin, setSetMin] = useState(defaultStartSequence.setToGunMin);
  const [setMax, setSetMax] = useState(defaultStartSequence.setToGunMax);
  const [reaction, setReaction] = useState<number | null>(null);
  const [result, setResult] = useState<{ raw: number } | null>(null);
  const [gunInfo, setGunInfo] = useState('');

  useEffect(() => {
    Network.getIpAddressAsync().then(setIp).catch(() => setIp('（取得失敗）'));
    PrecisionClock.prepareAudio().catch((e) => setGunInfo(`音訊初始化失敗：${e.message}`));
    const l = new Link();
    link.current = l;
    const off = l.on((m, from) => {
      if (m.type === 'hello') {
        setPeer(from.address);
        l.connect(from.address, from.port);
        l.send({ type: 'hello', role: 'start', name: 'start', v: 1 });
      } else if (m.type === 'arm') setFinishReady(true);
      else if (m.type === 'result' && m.raceId === race.current?.id) setResult({ raw: m.raw });
    });
    return () => {
      off();
      l.close();
    };
  }, []);

  const onEnergy = (t: number, e: number) => {
    const r = race.current;
    if (!r) return;
    // 預備後 0.6–1.2 秒當作「靜止基準」，之後開始偵測（鳴槍前的動作也會被抓到 = 搶跑）
    if (t < r.watchFrom - 0.6) return;
    const onset = motion.current.push(t, e, t < r.watchFrom ? 'still' : 'watch');
    if (onset && !reported.current && r.gun !== undefined) reportReaction(onset.t);
  };

  const reportReaction = (tOnset: number) => {
    const r = race.current!;
    if (r.gun === undefined || reported.current) return;
    reported.current = true;
    const heard = r.gun + speakerDist / 343.2;
    const rt = tOnset - heard;
    setReaction(rt);
    link.current?.sendReliable({ type: 'reaction', raceId: r.id, tOnset });
  };

  const start = async () => {
    const l = link.current!;
    const now = PrecisionClock.now;
    const id = Math.random().toString(36).slice(2, 8);
    const plan = planStart({ ...defaultStartSequence, setToGunMin: setMin, setToGunMax: Math.max(setMin, setMax) });
    const t0 = now();
    motion.current.reset();
    reported.current = false;
    setReaction(null);
    setResult(null);
    setFinishReady(false);
    race.current = { id, set: t0 + plan.set, watchFrom: t0 + plan.set + 1.2 };

    // 通知終點：開始學背景、進入待命
    if (peer) l.sendReliable({ type: 'status', raceId: id, phase: 'marks' });
    await sleepUntil(now, t0 + plan.marks);
    setPhase('marks');
    speak('marks', lang);
    await sleepUntil(now, t0 + plan.set);
    setPhase('set');
    speak('set', lang);
    if (peer) l.sendReliable({ type: 'status', raceId: id, phase: 'set' });
    // 槍聲由原生端排程在精準時間播放，回傳實際從喇叭發出的時間
    const gun = await PrecisionClock.playGunAt(t0 + plan.gun);
    race.current.gun = gun.emittedAt;
    setGunInfo(`鳴槍量測方式：${gun.method}，輸出延遲 ${(gun.outputLatency * 1000).toFixed(1)}ms`);
    setPhase('gun');
    if (peer) l.sendReliable({ type: 'gun', raceId: id, tGun: gun.emittedAt }, 6);
    // 鳴槍前就偵測到動作（搶跑）
    const pre = motion.current.onset;
    if (pre) reportReaction(pre.t);
    setTimeout(() => {
      if (!motion.current.onset && useCam) link.current?.sendReliable({ type: 'reaction', raceId: id, tOnset: null });
      setPhase('done');
    }, 2000);
  };

  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const lastRace = useRef('');
  const falseStart = reaction !== null && reaction < FALSE_START;

  // 收到成績就記一筆
  useEffect(() => {
    const id = race.current?.id;
    if (!result || !id || lastRace.current === id) return;
    lastRace.current = id;
    setHistory((h) => [...h, { n: h.length + 1, raw: falseStart ? null : result.raw }]);
  }, [result, falseStart]);

  if (result) {
    return (
      <ResultView
        raw={result.raw}
        reaction={reaction ?? undefined}
        falseStart={falseStart}
        context="雙手機"
        history={history}
        onAgain={() => {
          setResult(null);
          setReaction(null);
          setPhase('idle');
        }}
        onHome={onBack}
      />
    );
  }

  const busy = phase === 'marks' || phase === 'set';
  const step = PHASE_VIEW[phase];
  const stepIdx = ['marks', 'set', 'gun'].indexOf(phase === 'done' ? 'gun' : phase);
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { flexGrow: 1 }]}>
        <Header onBack={onBack} kicker="雙手機 · 起點" title="起跑手機" right={<IconBtn label="設定" glyph="⋯" onPress={() => setShowSettings((v) => !v)} />} />
        <View style={s.wrap}>
          {peer ? <Chip tone="info" dot text={finishReady ? '終點已連線 · 待命中' : '終點已連線'} /> : <Chip tone="neutral" dot text={`等待終點連線 · 本機 IP ${ip}`} />}
          {history.length ? <Chip text={`第 ${history.length + 1} 趟`} /> : null}
        </View>

        {falseStart ? (
          <View style={[styles.panel, { backgroundColor: C.badBg, borderWidth: 2, borderColor: C.bad }]}>
            <Text style={{ color: C.badText, fontSize: 44, fontWeight: '900' }}>搶跑</Text>
            <Text style={[NUM, { color: '#FFC2CA', fontSize: 22 }]}>反應 {reaction!.toFixed(3)} s</Text>
            <Text style={{ color: '#FFC2CA', fontSize: 15 }}>低於 0.100 秒判定搶跑，這趟不計。</Text>
          </View>
        ) : (
          <View style={[styles.panel, { backgroundColor: C.card, borderWidth: 1, borderColor: C.line }]}>
            <Text style={{ color: C.dim, fontSize: 15, letterSpacing: 1.5 }}>{step.label}</Text>
            <Text style={{ color: step.color, fontSize: 64, fontWeight: '900' }}>{step.text}</Text>
            <View style={[s.row, { marginTop: 8 }]}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: i <= stepIdx ? C.accent : C.line }} />
              ))}
            </View>
            <Text style={{ color: C.dim, fontSize: 14, marginTop: 8 }}>
              預備→鳴槍 隨機 {setMin}–{Math.max(setMin, setMax)} 秒
            </Text>
          </View>
        )}

        <View style={[s.row, { gap: 10, alignItems: 'stretch' }]}>
          <Stat label="反應時間（參考）" value={reaction !== null ? `${reaction.toFixed(3)} s` : '—'} color={falseStart ? C.badText : undefined} />
          <View style={[s.card, { flex: 1, padding: 12, gap: 4, borderRadius: 14 }]}>
            <Text style={{ color: C.dim, fontSize: 12 }}>起跑偵測相機</Text>
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: useCam }} onPress={() => setUseCam(!useCam)} style={{ minHeight: 30, justifyContent: 'center' }}>
              <Text style={{ color: useCam ? C.infoText : C.dim, fontSize: 18, fontWeight: '700' }}>{useCam ? '開啟' : '關閉'}</Text>
            </Pressable>
          </View>
        </View>
        {useCam ? (
          <View style={{ height: 150, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' }}>
            <StartCamera onEnergy={onEnergy} />
          </View>
        ) : null}

        {showSettings ? (
          <View style={s.card}>
            <SectionTitle>口令語言</SectionTitle>
            <Segmented<CommandLang> options={['zh', 'en']} value={lang} onChange={setLang} fmt={(l) => (l === 'zh' ? '中文' : 'English')} />
            <NumField label="預備→鳴槍 最短" value={setMin} onChange={setSetMin} unit="秒" />
            <NumField label="預備→鳴槍 最長" value={setMax} onChange={setSetMax} unit="秒" />
            <NumField label="手機喇叭到跑者距離" value={speakerDist} onChange={setSpeakerDist} unit="公尺" />
            {gunInfo ? <Text style={s.note}>{gunInfo}</Text> : null}
          </View>
        ) : null}

        <View style={{ flex: 1 }} />
        {busy ? (
          <Btn big kind="danger" title={phase === 'marks' ? '各就位…' : '預備…'} onPress={() => {}} disabled />
        ) : falseStart ? (
          <Btn big title="重新起跑" onPress={start} />
        ) : (
          <Btn big title={phase === 'idle' ? '開始口令' : '再一次'} onPress={start} />
        )}
        {phase === 'gun' || phase === 'done' ? <Text style={[s.note, { textAlign: 'center' }]}>已鳴槍，等待終點回傳成績…</Text> : null}
      </ScrollView>
    </View>
  );
}

const FALSE_START = 0.1;

const PHASE_VIEW: Record<Phase, { label: string; text: string; color: string }> = {
  idle: { label: '準備好就按開始', text: '待命', color: C.text },
  marks: { label: 'ON YOUR MARKS', text: '各就位', color: C.text },
  set: { label: 'SET', text: '預備', color: C.warn },
  gun: { label: 'GO', text: '砰！', color: C.accent },
  done: { label: 'GO', text: '砰！', color: C.accent },
};

const styles = StyleSheet.create({
  panel: { minHeight: 260, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
});
