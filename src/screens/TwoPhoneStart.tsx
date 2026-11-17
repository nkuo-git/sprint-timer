import { useKeepAwake } from 'expo-keep-awake';
import * as Network from 'expo-network';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { MotionOnsetDetector, defaultMotionConfig } from '../core/reaction';
import { defaultStartSequence, planStart } from '../core/startSequence';
import { StartCamera } from '../camera/StartCamera';
import { Link } from '../net/link';
import { BigTime, Btn, C, Label, NumField, Row, s } from '../ui/kit';
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

  const busy = phase === 'marks' || phase === 'set';
  return (
    <View style={s.screen}>
      {useCam ? (
        <View style={{ height: 240 }}>
          <StartCamera onEnergy={onEnergy} />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.title}>起跑手機</Text>
        <View style={s.card}>
          <Label>本機 IP：{ip}（終點手機輸入這個）</Label>
          <Label dim>{peer ? `已連線：${peer}` : '等待終點手機連線…（兩支手機需在同一個 Wi-Fi 或熱點）'}</Label>
          <Label dim>{finishReady ? '終點已待命' : '終點尚未待命'}</Label>
        </View>
        <View style={s.card}>
          <Row>
            <Label>用相機量反應時間</Label>
            <Switch value={useCam} onValueChange={setUseCam} />
          </Row>
          <Row>
            <Label>口令語言：</Label>
            <Btn kind="ghost" title={lang === 'zh' ? '中文' : 'English'} onPress={() => setLang(lang === 'zh' ? 'en' : 'zh')} />
          </Row>
          <NumField label="預備→鳴槍 最短" value={setMin} onChange={setSetMin} unit="秒" />
          <NumField label="預備→鳴槍 最長" value={setMax} onChange={setSetMax} unit="秒" />
          <NumField label="手機喇叭到跑者距離" value={speakerDist} onChange={setSpeakerDist} unit="公尺" />
        </View>
        <Btn title={busy ? (phase === 'marks' ? '各就位…' : '預備…') : '開始口令'} onPress={start} disabled={busy} />
        {phase === 'gun' || phase === 'done' ? <Text style={[s.label, { color: C.accent }]}>已鳴槍</Text> : null}
        {reaction !== null ? (
          <View style={s.card}>
            <Label>反應時間（相機，參考值）</Label>
            <BigTime seconds={reaction} sub={reaction < 0.1 ? '⚠ 搶跑' : undefined} />
          </View>
        ) : null}
        {result ? (
          <View style={s.card}>
            <Label>成績（終點手機回傳）</Label>
            <BigTime seconds={result.raw} />
          </View>
        ) : null}
        <Label dim>{gunInfo}</Label>
        <Btn kind="ghost" title="返回" onPress={onBack} />
      </ScrollView>
    </View>
  );
}
