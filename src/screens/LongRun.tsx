import * as Speech from 'expo-speech';
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import { runBests, uuid } from '../records/store';
import { averagePace, durationLabel, kmLabel, paceLabel, targetLabel } from '../run/format';
import { phoneLocation } from '../run/location';
import { RunSession, type GpsState, type RunSnapshot } from '../run/session';
import { fileStorage } from '../storage/fileStorage';
import { Btn, C, Header, NUM, s } from '../ui/kit';
import { RouteMap } from '../ui/RouteMap';
import { RunSummary, type RunSaveState } from './RunSummary';

const TARGETS: (number | null)[] = [null, 1000, 3000, 5000, 10000];
const prefsFile = fileStorage('run-prefs.json');

/** 上次選的目標距離和語音設定（下次打開長跑時沿用） */
let prefs: { targetM: number | null; voice: boolean; custom: number | null } = { targetM: 5000, voice: true, custom: null };
let prefsLoaded = false;

/** 設計稿「28 準備開始」「29 跑步中」，跑完接「30 成績與路線」 */
export function LongRun({ onBack, onHome }: { onBack(): void; onHome(): void }) {
  const { account, service } = useAccount();
  const [key, setKey] = useState(0);
  const session = useMemo(
    () =>
      new RunSession({
        location: phoneLocation,
        now: () => Date.now(),
        save: (run) => service.saveRun(run),
        speak: (text) => Speech.speak(text, { language: 'zh-TW', rate: 0.95 }),
        newId: uuid,
      }),
    [service, key],
  );
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [, setTick] = useState(0);

  useEffect(() => {
    void session.open();
    return () => session.dispose();
  }, [session]);

  // 計時數字每秒更新；同時讓「訊號斷了」「停下來」這類狀態跟著時間更新
  useEffect(() => {
    if (snap.phase === 'finished') return;
    const t = setInterval(() => {
      session.refresh();
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [session, snap.phase]);

  // 跑步中按返回鍵：問要不要放棄
  useEffect(() => {
    if (snap.phase !== 'running' && snap.phase !== 'paused') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('放棄這次跑步？', '這次的距離和路線不會儲存。想結束並存檔的話，先按暫停，再長按「結束」。', [
        { text: '繼續跑', style: 'cancel' },
        { text: '放棄', style: 'destructive', onPress: onBack },
      ]);
      return true;
    });
    return () => sub.remove();
  }, [snap.phase, onBack]);

  if (snap.phase === 'finished' && snap.result) {
    const stored = service.store.run(snap.result.id);
    const uid = account.user?.id ?? null;
    const saveState: RunSaveState = !snap.result.saved || !stored ? 'not-saved' : !uid ? 'local' : stored.dirty ? 'pending' : 'cloud';
    const best = snap.result.targetM !== null ? runBests(service.store.runs(uid)).get(snap.result.targetM) : undefined;
    return (
      <RunSummary
        run={snap.result}
        save={saveState}
        personalBest={!!stored && best?.id === stored.id && service.store.runs(uid).filter((r) => r.targetM === stored.targetM && r.completed).length > 1}
        onBack={onBack}
        onHome={onHome}
        onAgain={() => setKey((k) => k + 1)}
      />
    );
  }
  if (snap.phase === 'setup') return <Setup session={session} snap={snap} onBack={onBack} />;
  return <Running session={session} snap={snap} />;
}

function Setup({ session, snap, onBack }: { session: RunSession; snap: RunSnapshot; onBack(): void }) {
  const [target, setTarget] = useState<number | null>(prefs.targetM);
  const [custom, setCustom] = useState<number | null>(prefs.custom);
  const [editing, setEditing] = useState(false);
  const [voice, setVoice] = useState(prefs.voice);

  useEffect(() => {
    if (prefsLoaded) return;
    prefsLoaded = true;
    void prefsFile
      .load()
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        prefs = { targetM: typeof p.targetM === 'number' ? p.targetM : null, voice: p.voice !== false, custom: typeof p.custom === 'number' ? p.custom : null };
        setTarget(prefs.targetM);
        setCustom(prefs.custom);
        setVoice(prefs.voice);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    session.setTarget(target);
    session.setVoice(voice);
    prefs = { targetM: target, voice, custom };
    void prefsFile.save(JSON.stringify(prefs)).catch(() => undefined);
  }, [session, target, voice, custom]);

  const isCustom = target !== null && !TARGETS.includes(target);
  const gps = snap.gps;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 16, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Header onBack={onBack} title="長跑計時" right={<GpsPill gps={gps} accuracyM={snap.accuracyM} />} />

        <View>
          <RouteMap track={[]} position={snap.position} accuracyM={snap.accuracyM} live height={220} marks={false} label="地圖：目前位置" />
          {gps !== 'good' ? (
            <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 18, backgroundColor: gps === 'denied' ? 'rgba(14,17,22,0.86)' : 'rgba(14,17,22,0.72)', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 28 }}>
              <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{gps === 'denied' ? '需要定位權限' : '正在找衛星訊號'}</Text>
              <Text style={{ color: C.soft, fontSize: 14, lineHeight: 22, textAlign: 'center' }}>
                {gps === 'denied' ? '用 GPS 量距離和記錄路線。只在你按下開始之後記錄，結束就停止。' : '到沒有遮蔽的地方會比較快，通常 10 到 30 秒。'}
              </Text>
            </View>
          ) : snap.accuracyM !== null ? (
            <View style={{ position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(14,17,22,0.85)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
              <Text style={{ color: C.soft, fontSize: 13 }}>
                定位誤差約 <Text style={[NUM, { color: C.text, fontWeight: '700' }]}>±{Math.round(snap.accuracyM)} m</Text>
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>目標距離</Text>
            <Text style={{ color: C.dim, fontSize: 13 }}>{target === null ? '想停的時候自己按結束' : '到了自動停錶'}</Text>
          </View>
          <View style={[s.row, { gap: 6 }]}>
            {TARGETS.map((t) => (
              <TargetChip key={String(t)} title={targetLabel(t)} on={!editing && target === t} onPress={() => (setEditing(false), setTarget(t))} />
            ))}
            <TargetChip
              title={isCustom && !editing ? targetLabel(target) : '自訂'}
              on={editing || isCustom}
              onPress={() => {
                setEditing(true);
              }}
            />
          </View>
          {editing ? (
            <View style={[s.row, { gap: 10 }]}>
              <Text style={[s.label, { flex: 1 }]}>自訂距離</Text>
              <TextInput
                autoFocus
                style={[s.input, { minWidth: 100, fontSize: 18 }]}
                keyboardType="decimal-pad"
                placeholder="例如 21.1"
                placeholderTextColor={C.faint}
                defaultValue={custom ? String(custom / 1000) : ''}
                onEndEditing={(e) => {
                  const km = parseFloat(e.nativeEvent.text.replace(',', '.'));
                  if (Number.isFinite(km) && km >= 0.1 && km <= 500) {
                    const m = Math.round(km * 1000);
                    setCustom(m);
                    setTarget(m);
                  }
                  setEditing(false);
                }}
              />
              <Text style={s.label}>km</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: voice }}
          accessibilityLabel="每公里語音報時"
          onPress={() => setVoice((v) => !v)}
          style={({ pressed }) => [s.card, s.row, { minHeight: 64, paddingVertical: 10, gap: 12 }, pressed && { opacity: 0.85 }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>每公里語音報時</Text>
            <Text style={{ color: C.dim, fontSize: 13 }}>報出距離、時間和這一公里的配速</Text>
          </View>
          <View style={{ width: 56, height: 32, borderRadius: 16, backgroundColor: voice ? C.accent : C.raised, justifyContent: 'center', paddingHorizontal: 3, alignItems: voice ? 'flex-end' : 'flex-start' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: voice ? C.bg : C.dim }} />
          </View>
        </Pressable>

        <Text style={{ color: C.dim, fontSize: 14, lineHeight: 22 }}>手機放口袋或臂套就好，螢幕關掉也會繼續記錄。GPS 量出來的距離大約有 1 到 2% 的誤差。</Text>

        <View style={{ flex: 1 }} />
        {gps === 'denied' || gps === 'unknown' ? (
          <Btn big title="允許定位" onPress={() => void session.requestPermission()} style={{ backgroundColor: C.info }} disabled={gps === 'unknown'} />
        ) : gps === 'searching' ? (
          <>
            <Text style={{ color: C.warn, fontSize: 14, lineHeight: 22, textAlign: 'center' }}>GPS 還沒定位好。現在開始的話，前面一小段距離可能不準。</Text>
            <Btn big kind="ghost" title="不等了，先開始" onPress={() => void session.start()} style={{ borderWidth: 2, borderColor: C.accent, backgroundColor: 'transparent' }} textStyle={{ color: C.accent, fontWeight: '900' }} />
          </>
        ) : (
          <Btn big title="開始跑" onPress={() => void session.start()} textStyle={{ fontSize: 24 }} />
        )}
      </ScrollView>
    </View>
  );
}

function Running({ session, snap }: { session: RunSession; snap: RunSnapshot }) {
  const running = snap.phase === 'running';
  const elapsed = session.elapsed();
  const [hint, setHint] = useState<string | null>(null);
  const target = snap.targetM;
  const progress = target ? Math.min(1, snap.distanceM / target) : 0;
  const statusColor = running ? C.badText : C.warn;
  const hintText = hint ?? (running ? (snap.background ? '螢幕關掉也會繼續記錄' : '這支手機不能在背景記錄，跑步時請讓 App 保持在畫面上') : '暫停中不計時間、不算距離');

  return (
    <View style={[s.screen, s.pad, { gap: 14 }]}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View style={[s.chip, { backgroundColor: C.card }]}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: running ? C.bad : C.warn }} />
          <Text style={{ color: statusColor, fontSize: 14, fontWeight: '700' }}>{running ? '記錄中' : '已暫停'}</Text>
        </View>
        <GpsPill gps={snap.gps} accuracyM={snap.accuracyM} compact />
      </View>

      <View style={{ gap: 8 }} accessible accessibilityLabel={`距離 ${kmLabel(snap.distanceM)} 公里`}>
        <Text style={{ color: C.dim, fontSize: 15 }}>距離</Text>
        <View style={[s.row, { alignItems: 'baseline', gap: 8 }]}>
          <Text style={[NUM, { color: C.accent, fontSize: 104, fontWeight: '700', lineHeight: 104 }]} numberOfLines={1} adjustsFontSizeToFit>
            {kmLabel(snap.distanceM)}
          </Text>
          <Text style={{ color: C.soft, fontSize: 26, fontWeight: '700' }}>km</Text>
        </View>
        {target ? (
          <>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.raised, overflow: 'hidden', marginTop: 6 }}>
              <View style={{ width: `${Math.round(progress * 100)}%`, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
            </View>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: C.dim, fontSize: 14 }}>
                目標 <Text style={[NUM, { color: C.soft, fontWeight: '700' }]}>{targetLabel(target)}</Text>
              </Text>
              <Text style={{ color: C.dim, fontSize: 14 }}>
                還有 <Text style={[NUM, { color: C.soft, fontWeight: '700' }]}>{kmLabel(Math.max(0, target - snap.distanceM))} km</Text>
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Cell label="時間" value={durationLabel(elapsed)} big color={running ? C.text : C.warn} />
          <Cell label="平均配速 /km" value={paceLabel(averagePace(snap.distanceM, elapsed))} big />
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <Cell label="目前配速 /km" value={running ? paceLabel(snap.currentPace) : '--'} />
          <Cell label={snap.lastSplit ? `第 ${snap.lastSplit.km} 公里` : '上一公里'} value={paceLabel(snap.lastSplit?.seconds)} />
        </View>
      </View>

      <RouteMap track={snap.track} position={snap.position} live marks={false} label="地圖：到目前為止的路線" style={{ flex: 1, minHeight: 120 }} />

      {running ? (
        <Btn big title="暫停" onPress={() => session.pause()} style={{ backgroundColor: 'transparent', borderWidth: 2, borderColor: C.accent }} textStyle={{ color: C.accent, fontSize: 24 }} />
      ) : (
        <View style={[s.row, { gap: 10 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="結束"
            accessibilityHint="長按一秒結束並儲存"
            delayLongPress={1000}
            onPress={() => {
              setHint('長按 1 秒才會結束');
              setTimeout(() => setHint(null), 2500);
            }}
            onLongPress={() => void session.finish()}
            style={({ pressed }) => [{ flex: 1, minHeight: 72, borderRadius: 20, borderWidth: 2, borderColor: C.bad, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: C.badBg }]}
          >
            <Text style={{ color: C.badText, fontSize: 20, fontWeight: '900' }}>結束</Text>
            <Text style={{ color: C.badText, fontSize: 12 }}>長按 1 秒</Text>
          </Pressable>
          <Btn big title="繼續" onPress={() => session.resume()} style={{ flex: 1 }} textStyle={{ fontSize: 24 }} />
        </View>
      )}
      <Text style={{ color: hint ? C.warn : C.dim, fontSize: 13, textAlign: 'center' }}>{hintText}</Text>
    </View>
  );
}

function Cell({ label, value, big, color }: { label: string; value: string; big?: boolean; color?: string }) {
  return (
    <View style={[s.card, { flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 2, borderRadius: 14 }]}>
      <Text style={{ color: C.dim, fontSize: 13 }}>{label}</Text>
      <Text style={[NUM, { color: color ?? C.text, fontSize: big ? 36 : 28, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function GpsPill({ gps, accuracyM, compact }: { gps: GpsState; accuracyM: number | null; compact?: boolean }) {
  const t =
    gps === 'good'
      ? { bg: C.infoBg, fg: C.infoText, dot: C.info, text: compact && accuracyM !== null ? `GPS ±${Math.round(accuracyM)} m` : 'GPS 良好' }
      : gps === 'searching'
        ? { bg: '#2E2610', fg: C.warn, dot: C.warn, text: '搜尋 GPS 中' }
        : gps === 'denied'
          ? { bg: C.badBg, fg: C.badText, dot: C.bad, text: '未開啟定位' }
          : { bg: C.raised, fg: C.soft, dot: C.dim, text: 'GPS' };
  return (
    <View style={[s.chip, { backgroundColor: t.bg }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.dot }} />
      <Text style={[NUM, { color: t.fg, fontSize: 14, fontWeight: '500' }]}>{t.text}</Text>
    </View>
  );
}

function TargetChip({ title, on, onPress }: { title: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, minHeight: 48, borderRadius: 999, backgroundColor: on ? C.text : C.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, pressed && { opacity: 0.75 }]}
    >
      <Text style={[NUM, { color: on ? C.onAccent : C.soft, fontSize: 15, fontWeight: on ? '700' : '400' }]} numberOfLines={1} adjustsFontSizeToFit>
        {title}
      </Text>
    </Pressable>
  );
}
