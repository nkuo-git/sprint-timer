import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrecisionClock } from '../../modules/precision-clock';
import { useAccount } from '../account/AccountContext';
import { MultiFinishCamera, type MultiFinishHandle, type MultiTelemetry } from '../camera/MultiFinishCamera';
import { frameToView } from '../camera/mapping';
import type { FinishEvent } from '../core/multiFinish';
import type { FinishSession, RunnerMark } from '../finish/session';
import { useFinishSession } from '../finish/useFinishSession';
import { RaceDraft } from '../records/draft';
import { distanceLabel } from '../records/format';
import type { RaceMode } from '../records/types';
import { Btn, C, Chip, Header, IconBtn, NUM, NumField, Segmented, s } from './kit';
import { PickRunner, RunnerPill } from './PickRunner';

/**
 * 手持終點（設計稿 7 點選終點線、8 計時中、9 多人成績）。
 * 雙手機的終點手機和單手機模式共用；起跑時刻 startAt 由外面的畫面提供。
 */
export interface HandheldHandle {
  /** 學背景並開始記錄。終點線還沒鎖定時回傳 false */
  arm(): boolean;
  /** 停止記錄，回到瞄準狀態（保留終點線） */
  stop(): void;
}

interface Props {
  onBack(): void;
  /** 存紀錄用：哪一種計時方式 */
  mode: RaceMode;
  signal?: 'sound' | 'flash';
  /** 這一趟的距離（公尺）；還不知道時為 null */
  distanceM: number | null;
  /** 有給的話可以在成績畫面改距離（雙手機模式沒有事先設定距離） */
  onDistanceChange?(meters: number): void;
  /** 起點手機量到的反應時間。只有一位跑者時才知道是誰的，才會記到成績上 */
  raceExtra?: { reaction?: number; falseStart?: boolean };
  raceNo: number;
  fps: number;
  torch?: boolean;
  /** 起跑時刻（本機時鐘）。還沒鳴槍時為 null */
  startAt: number | null;
  /** 待命後、鳴槍前顯示的狀態（各就位、預備…） */
  status?: string;
  chips?: React.ReactNode;
  /** 瞄準階段下方的操作（開始口令、連線…） */
  idleControls(locked: boolean): React.ReactNode;
  /** 待命後、鳴槍前的操作（取消） */
  waitControls?: React.ReactNode;
  /** 成績畫面上的補充說明（例如反應時間） */
  resultNote?: string;
  onArmed?(): void;
  onRunner?(t: number, frameInterval: number): void;
  /** 看完成績按「再跑一趟」 */
  onAgain(): void;
}

const TILT_WARN_DEG = 8;

type Aim = 'tap' | 'searching' | 'locked' | 'tilted' | 'lost';

const AIM_TEXT: Record<Aim, { chip: string; tone: string; head: string; body: string }> = {
  tap: { chip: '尚未設定', tone: C.soft, head: '點一下畫面上的終點線', body: '手機直拿，對準地上的白色終點線，用手指點它一下，App 會自己辨識出整條線。' },
  searching: { chip: '辨識中…', tone: C.warn, head: '正在找終點線…', body: '手機盡量拿穩，保持終點線在畫面裡。' },
  locked: { chip: '已鎖定終點線', tone: C.infoText, head: '已鎖定，會自動追蹤', body: '手稍微晃動沒關係，橘色框會跟著終點線走。多人時把手機舉高一點，比較不會互相擋住。點別的地方可以重新設定。' },
  tilted: { chip: '已鎖定 · 角度偏', tone: C.warn, head: '可以計時，但會比較不準', body: '站到終點線的延長線上，線變直之後警告就會消失。' },
  lost: { chip: '找不到終點線', tone: C.badText, head: '終點線跑出畫面了', body: '把鏡頭轉回終點線，會自動重新鎖定。找不回來的話再點一次。' },
};

export const HandheldFinish = forwardRef<HandheldHandle, Props>(function HandheldFinish(props, ref) {
  const { onBack, mode, signal, distanceM, onDistanceChange, raceExtra, raceNo, fps, torch, startAt, status, chips, idleControls, waitControls, resultNote, onAgain } = props;
  const cam = useRef<MultiFinishHandle>(null);
  const draft = useRef<RaceDraft | null>(null);
  const { session, onEvent, version, refresh } = useFinishSession();
  const latest = useRef(props);
  latest.current = props;
  const hadLine = useRef(false);
  const [tele, setTele] = useState<MultiTelemetry | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [arming, setArming] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const line = session.line;
  if (line) hadLine.current = true;
  const locked = !!line?.locked;
  const armed = session.phase === 'armed';
  const aim: Aim = !line ? (hadLine.current ? 'lost' : 'tap') : !line.locked ? 'searching' : Math.abs(line.tiltDeg) > TILT_WARN_DEG ? 'tilted' : 'locked';

  const handleEvent = (e: FinishEvent) => {
    onEvent(e);
    if (e.type === 'armed') {
      setArming(false);
      latest.current.onArmed?.();
    } else if (e.type === 'runner') latest.current.onRunner?.(e.t, e.frameInterval);
  };

  const stop = () => {
    cam.current?.stop();
    session.stopped();
    setArming(false);
    refresh();
  };

  useImperativeHandle(ref, () => ({
    arm() {
      if (!session.line?.locked) return false;
      session.reset();
      setShowResults(false);
      setArming(true);
      cam.current?.arm();
      refresh();
      return true;
    },
    stop,
  }));

  const running = armed && startAt !== null && !showResults;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(PrecisionClock.now() - startAt!), 47);
    return () => clearInterval(id);
  }, [running, startAt]);

  const results = startAt !== null ? session.results(startAt) : [];
  const timebaseOk = tele ? tele.lag > -0.01 && tele.lag < 0.3 : true;
  const a = AIM_TEXT[aim];

  // 終點線框：影格座標 → 畫面座標
  let lineBox: React.ReactNode = null;
  if (line && tele && view.w) {
    const p1 = frameToView(line.xTop, line.yTop, view.w, view.h, tele.frameW, tele.frameH, 'cover');
    const p2 = frameToView(line.xBot, line.yBot, view.w, view.h, tele.frameW, tele.frameH, 'cover');
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const color = aim === 'locked' ? C.accent : C.warn;
    lineBox = (
      <View
        style={{
          position: 'absolute',
          left: (p1.x + p2.x) / 2 - 12,
          top: (p1.y + p2.y) / 2 - len / 2,
          width: 24,
          height: len,
          borderWidth: 3,
          borderRadius: 6,
          borderColor: color,
          borderStyle: line.locked ? 'solid' : 'dashed',
          transform: [{ rotate: `${(-Math.atan2(dx, dy) * 180) / Math.PI}deg` }],
        }}
      />
    );
  }

  return (
    <View style={[s.screen, { backgroundColor: '#000' }]}>
      <View style={{ flex: 1 }}>
        <MultiFinishCamera ref={cam} targetFps={fps} torch={torch} resizeMode="cover" tapToSetLine={!armed && !arming} onEvent={handleEvent} onTelemetry={setTele}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {lineBox}
            {aim === 'lost' ? <View style={[StyleSheet.absoluteFill, { borderWidth: 6, borderColor: C.bad }]} /> : null}
          </View>
        </MultiFinishCamera>
        <View style={styles.hud} pointerEvents="box-none">
          <IconBtn translucent label="返回" glyph="‹" onPress={onBack} />
          <View style={[s.wrap, { flex: 1, justifyContent: 'flex-end' }]}>
            {armed ? (
              <View style={[s.chip, { backgroundColor: 'rgba(14,17,22,0.85)' }]}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.bad }} />
                <Text style={{ color: C.badText, fontSize: 14, fontWeight: '700' }}>記錄中</Text>
              </View>
            ) : null}
            <View style={[s.chip, { backgroundColor: 'rgba(14,17,22,0.85)' }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.tone }} />
              <Text style={{ color: a.tone, fontSize: 14, fontWeight: '700' }}>{a.chip}</Text>
            </View>
            <Chip tone="overlay" text={tele ? `${tele.fps.toFixed(0)} fps` : `${fps} fps`} />
            {chips}
          </View>
        </View>
        {aim === 'tilted' && !armed ? (
          <View style={styles.tilt}>
            <Text style={{ color: C.warn, fontSize: 24 }}>⚠</Text>
            <Text style={{ color: '#FFE2A6', fontSize: 15, lineHeight: 22, flex: 1 }}>終點線看起來是斜的。請站到終點線的延長線上，讓線在畫面裡是直的。</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.sheet}>
        {!timebaseOk ? <Text style={{ color: C.badText, fontSize: 14 }}>⚠ 相機時間基準異常（差 {(tele!.lag * 1000).toFixed(0)}ms），這支手機的結果不可信</Text> : null}
        {running ? (
          <>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
              <View style={{ gap: 2 }}>
                <Text style={{ color: C.dim, fontSize: 14 }}>計時中</Text>
                <Text style={[NUM, { color: C.text, fontSize: 48, fontWeight: '700', lineHeight: 52 }]}>{elapsed.toFixed(2)}</Text>
              </View>
              <Text style={{ color: C.soft, fontSize: 15 }}>
                已衝線 <Text style={[NUM, { color: C.accent, fontSize: 22, fontWeight: '700' }]}>{results.length}</Text> 人
              </Text>
            </View>
            <View>
              {[...results]
                .reverse()
                .slice(0, 3)
                .map((r, i) => (
                  <View key={r.id} style={[s.row, { gap: 12, minHeight: 52, borderTopWidth: 1, borderTopColor: C.raised }]}>
                    <View style={[styles.badge, { backgroundColor: i === 0 ? C.accent : C.raised }]}>
                      <Text style={[NUM, { color: i === 0 ? C.onAccent : C.text, fontSize: 16, fontWeight: '700' }]}>{r.place}</Text>
                    </View>
                    <Text style={{ color: C.soft, fontSize: 15, flex: 1 }}>
                      第 {r.place} 位{i === 0 ? ' · 剛剛衝線' : ''}
                    </Text>
                    <Text style={[NUM, { color: i === 0 ? C.accent : C.text, fontSize: 24, fontWeight: '700' }]}>{r.official.toFixed(2)}</Text>
                  </View>
                ))}
            </View>
            <Btn
              kind="danger"
              title="全部跑完，看成績"
              onPress={() => {
                stop();
                // 這一趟的紀錄從這裡開始：之後在成績畫面的每次修改都存到同一筆
                const d = new RaceDraft(mode, { distanceM, signal });
                // 單手機、只有一個人：通常就是自己計時自己，先標記成「我自己」（可以改）
                if (mode === 'single-phone' && results.length === 1) d.tag(results[0].id, { kind: 'self' });
                draft.current = d;
                setShowResults(true);
              }}
              style={{ minHeight: 64, borderColor: C.accent }}
              textStyle={{ color: C.accent, fontSize: 20, fontWeight: '900' }}
            />
          </>
        ) : armed || arming ? (
          <>
            <View style={{ gap: 4 }}>
              <Text style={{ color: C.text, fontSize: 20, fontWeight: '700' }}>{arming ? '學習背景中…' : status || '待命中，等待鳴槍'}</Text>
              <Text style={{ color: C.dim, fontSize: 14, lineHeight: 22 }}>終點線請保持淨空，手機對著終點線不要移開。</Text>
            </View>
            {waitControls}
          </>
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Text style={{ color: aim === 'tilted' ? C.warn : aim === 'lost' ? C.badText : C.text, fontSize: 20, fontWeight: '700' }}>{a.head}</Text>
              <Text style={{ color: C.dim, fontSize: 14, lineHeight: 22 }}>{a.body}</Text>
            </View>
            {idleControls(locked)}
          </>
        )}
      </View>

      {showResults && startAt !== null && draft.current ? (
        <View style={StyleSheet.absoluteFill}>
          <MultiResults
            session={session}
            version={version}
            refresh={refresh}
            startAt={startAt}
            draft={draft.current}
            distanceM={distanceM}
            onDistanceChange={onDistanceChange}
            raceExtra={raceExtra}
            raceNo={raceNo}
            note={resultNote}
            nudge={tele && tele.fps > 0 ? 1 / tele.fps : 1 / fps}
            onHome={onBack}
            onAgain={() => {
              setShowResults(false);
              session.reset();
              refresh();
              onAgain();
            }}
          />
        </View>
      ) : null}
    </View>
  );
});

const STRIP_H = 150;
const COL_REPEAT = 2;

const DISTANCES = ['60', '100', '200', '400', '自訂'];

/**
 * 設計稿「9 多人成績」＋「22 標記跑者」：終點照片 + 每位跑者的衝線畫面與時間，可補人、微調、刪除，
 * 並把每一筆標記給某個人。畫面上每次變動都會存進紀錄（先存手機，有登入就自動上傳）。
 */
export function MultiResults({
  session,
  version,
  refresh,
  startAt,
  draft,
  distanceM,
  onDistanceChange,
  raceExtra,
  raceNo,
  note,
  nudge,
  onHome,
  onAgain,
}: {
  session: FinishSession;
  version: number;
  refresh(): void;
  startAt: number;
  draft: RaceDraft;
  distanceM: number | null;
  onDistanceChange?(meters: number): void;
  raceExtra?: { reaction?: number; falseStart?: boolean };
  raceNo: number;
  note?: string;
  /** 微調一步的秒數（一格影格） */
  nudge: number;
  onHome(): void;
  onAgain(): void;
}) {
  const { account, service } = useAccount();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [tagRev, setTagRev] = useState(0);
  const [distOpen, setDistOpen] = useState(false);
  const [customDist, setCustomDist] = useState(false);
  const results = session.results(startAt);

  // 成績、標記、距離、反應時間有任何變動就存一次（內容沒變不會重複存）
  draft.distanceM = distanceM;
  useEffect(() => {
    void service.saveRace(draft.toRace(session.results(startAt), raceExtra));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, draft, session, startAt, version, tagRev, distanceM, raceExtra?.reaction, raceExtra?.falseStart]);

  const marks = new Map<number, RunnerMark>(session.marks.map((m) => [m.id, m]));

  // 照片的時間範圍只在進入畫面或新增/刪除跑者時重算，微調時不重產生影像
  const first = results.length ? startAt + results[0].time : null;
  const last = results.length ? startAt + results[results.length - 1].time : null;
  const strip = useMemo(() => {
    const st = session.strip;
    if (st.length === 0) return null;
    const end = st.timeAtColumn(st.length - 1);
    const from = first !== null ? first - 0.4 : Math.max(startAt, end - 4);
    const to = last !== null ? last + 0.4 : end;
    const img = st.imageUri(Math.max(from, startAt), to, COL_REPEAT);
    if (!img) return null;
    const scale = STRIP_H / img.h;
    return { ...img, scale, width: img.w * scale, fromT: st.timeAtColumn(img.firstCol), toT: st.timeAtColumn(img.lastCol) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, startAt, results.length, editing]);

  const xOf = (t: number) => (strip ? (session.strip.columnAtTime(t) - strip.firstCol + 0.5) * COL_REPEAT * strip.scale : 0);
  const mutate = (fn: () => void) => {
    fn();
    refresh();
  };
  void version;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 14, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Header
          onBack={onHome}
          kicker={`${results.length} 位跑者 · 手持`}
          title={`第 ${raceNo} 趟成績`}
          right={
            onDistanceChange ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={distanceM === null ? '選擇距離' : `距離 ${distanceM} 公尺，點一下修改`}
                onPress={() => setDistOpen((v) => !v)}
                style={({ pressed }) => [s.row, styles.distBtn, distanceM === null && { borderColor: C.info }, pressed && { opacity: 0.75 }]}
              >
                <Text style={[NUM, { color: distanceM === null ? C.infoText : C.text, fontSize: 17, fontWeight: '700' }]}>{distanceM === null ? '選距離' : distanceLabel(distanceM)}</Text>
                <Text style={{ color: C.dim, fontSize: 14 }}>{distOpen ? '▴' : '▾'}</Text>
              </Pressable>
            ) : (
              <View style={[s.row, styles.distBtn]}>
                <Text style={[NUM, { color: C.text, fontSize: 17, fontWeight: '700' }]}>{distanceLabel(distanceM)}</Text>
              </View>
            )
          }
        />
        {distOpen && onDistanceChange ? (
          <View style={{ gap: 10 }}>
            <Segmented<string>
              options={DISTANCES}
              value={customDist ? '自訂' : String(distanceM ?? '')}
              onChange={(v) => {
                if (v === '自訂') setCustomDist(true);
                else {
                  setCustomDist(false);
                  onDistanceChange(Number(v));
                  setDistOpen(false);
                }
              }}
              fmt={(v) => (v === '自訂' ? v : `${v}m`)}
            />
            {customDist ? <NumField label="這一趟的距離" value={distanceM ?? 100} onChange={(v) => v > 0 && onDistanceChange(v)} unit="公尺" /> : null}
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>終點照片</Text>
            <Text style={{ color: C.dim, fontSize: 13 }}>橫軸是時間，越左邊越早到</Text>
          </View>
          {strip ? (
            <ScrollView horizontal style={[styles.strip, { flexGrow: 0 }, editing && { borderWidth: 2, borderColor: C.info }]}>
              <Pressable
                disabled={!editing}
                accessibilityLabel="終點照片，點一下新增跑者"
                onPress={(e) => {
                  const col = e.nativeEvent.locationX / (COL_REPEAT * strip.scale) + strip.firstCol;
                  mutate(() => setSelected(session.addManual(session.strip.timeAtColumn(col)).id));
                }}
                style={{ width: strip.width, height: STRIP_H }}
              >
                <Image source={{ uri: strip.uri }} style={{ width: strip.width, height: STRIP_H }} resizeMode="stretch" />
                {results.map((r) => {
                  const m = marks.get(r.id)!;
                  const color = selected === r.id ? C.info : m.auto ? C.accent : C.info;
                  const x = xOf(m.t);
                  return (
                    <View key={r.id} pointerEvents="none" style={StyleSheet.absoluteFill}>
                      <View style={{ position: 'absolute', left: x - 1, top: 0, width: 2, height: STRIP_H, backgroundColor: color }} />
                      <View style={[styles.markBadge, { left: Math.max(0, x - 24), backgroundColor: color }]}>
                        <Text style={[NUM, { color: C.onAccent, fontSize: 13, fontWeight: '700' }]}>{r.place}</Text>
                      </View>
                    </View>
                  );
                })}
              </Pressable>
            </ScrollView>
          ) : (
            <View style={[styles.strip, { height: STRIP_H, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: C.dim, fontSize: 14 }}>沒有錄到終點照片</Text>
            </View>
          )}
          {strip ? (
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={[NUM, { color: C.dim, fontSize: 12 }]}>{(strip.fromT - startAt).toFixed(2)} s</Text>
              <Text style={[NUM, { color: C.dim, fontSize: 12 }]}>{(strip.toT - startAt).toFixed(2)} s</Text>
            </View>
          ) : null}
        </View>

        {editing ? (
          <View style={{ backgroundColor: C.infoBg, borderRadius: 14, padding: 12, gap: 10 }}>
            <View style={[s.row, { gap: 10 }]}>
              <Text style={{ color: '#C5DFF7', fontSize: 14, lineHeight: 21, flex: 1 }}>點照片上漏掉的跑者來新增。點下面的跑者可以微調或刪除。</Text>
              <Btn
                title="完成"
                onPress={() => {
                  setEditing(false);
                  setSelected(null);
                }}
                style={{ minHeight: 44, backgroundColor: C.info, borderRadius: 12 }}
                textStyle={{ fontSize: 15 }}
              />
            </View>
            {selected !== null && marks.has(selected) ? (
              <View style={[s.row, { gap: 8 }]}>
                <Btn kind="ghost" title="◀ 早一點" onPress={() => mutate(() => session.moveMark(selected, marks.get(selected)!.t - nudge))} style={{ flex: 1, minHeight: 48 }} textStyle={{ fontSize: 15 }} />
                <Btn kind="ghost" title="晚一點 ▶" onPress={() => mutate(() => session.moveMark(selected, marks.get(selected)!.t + nudge))} style={{ flex: 1, minHeight: 48 }} textStyle={{ fontSize: 15 }} />
                <Btn
                  kind="danger"
                  title="刪除"
                  onPress={() =>
                    mutate(() => {
                      session.removeMark(selected);
                      setSelected(null);
                    })
                  }
                  style={{ minHeight: 48 }}
                  textStyle={{ fontSize: 15 }}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <Btn kind="ghost" title="少抓了人？補上或調整" onPress={() => setEditing(true)} style={{ minHeight: 48 }} textStyle={{ fontSize: 15, fontWeight: '500' }} />
        )}

        <View>
          {results.length === 0 ? <Text style={{ color: C.dim, fontSize: 15, paddingVertical: 12 }}>沒有偵測到跑者。可以按上面的按鈕，在照片上手動補上。</Text> : null}
          {results.map((r) => {
            const m = marks.get(r.id)!;
            const sel = editing && selected === r.id;
            // 編輯模式整列可點（選取要微調的跑者）；平常只有標記膠囊可點
            const Row: React.ElementType = editing ? Pressable : View;
            return (
              <Row
                key={r.id}
                {...(editing ? { onPress: () => setSelected(r.id), accessibilityRole: 'button', accessibilityState: { selected: sel } } : {})}
                style={[s.row, { gap: 10, minHeight: 84, borderTopWidth: 1, borderTopColor: C.raised }, sel && { backgroundColor: C.infoBg }]}
              >
                <Text style={[NUM, { width: 22, color: r.place === 1 ? C.accent : C.dim, fontSize: 20, fontWeight: '700' }]}>{r.place}</Text>
                <View style={styles.thumb}>
                  {m.thumbUri ? <Image source={{ uri: m.thumbUri }} style={{ width: 56, height: 56 }} resizeMode="cover" accessibilityLabel="衝線瞬間" /> : <Text style={{ color: C.faint, fontSize: 11 }}>手動</Text>}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <RunnerPill runner={draft.runner(r.id)} selfNickname={account.nickname} disabled={editing} onPress={() => setPicking(r.id)} />
                  <Text style={[NUM, { color: C.dim, fontSize: 13 }]}>
                    {r.time.toFixed(3)} · {r.place === 1 ? '第一' : `+${(r.time - results[0].time).toFixed(2)}`}
                    {m.auto ? '' : ' · 手動'}
                  </Text>
                </View>
                <Text style={[NUM, { color: r.place === 1 ? C.accent : C.text, fontSize: 30, fontWeight: '700' }]}>{r.official.toFixed(2)}</Text>
              </Row>
            );
          })}
        </View>
        {results.length ? <SavedBanner /> : null}
        {note ? <Text style={s.note}>{note}</Text> : null}

        <View style={{ flex: 1 }} />
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="ghost" title="回首頁" onPress={onHome} style={{ flex: 1, minHeight: 64 }} />
          <Btn title="再跑一趟" onPress={onAgain} style={{ flex: 1, minHeight: 64 }} textStyle={{ fontSize: 18, fontWeight: '900' }} />
        </View>
      </ScrollView>

      <PickRunner
        target={(() => {
          const r = picking === null ? undefined : results.find((x) => x.id === picking);
          return r ? { place: r.place, official: r.official, distanceM, current: draft.runner(r.id), thumbUri: marks.get(r.id)?.thumbUri } : null;
        })()}
        onClose={() => setPicking(null)}
        onPick={(runner) => {
          if (picking !== null) draft.tag(picking, runner);
          setPicking(null);
          setTagRev((v) => v + 1);
        }}
      />
    </View>
  );
}

/** 成績畫面下方的一行：這一趟存到哪裡了 */
function SavedBanner() {
  const { account } = useAccount();
  let text = '已存到雲端。標記的人會在自己的紀錄裡看到這筆成績。';
  let warn = false;
  if (!account.user) text = account.cloudEnabled ? '已存在這支手機。登入後會存到雲端，也能標記給其他用戶。' : '已存在這支手機。';
  else if (account.sync.state === 'offline') {
    text = '現在沒有網路。成績先存在手機上，連上網路後會自動上傳。';
    warn = true;
  } else if (account.sync.state === 'error') {
    text = '上傳失敗，成績還在手機上，稍後會自動再試。';
    warn = true;
  } else if (account.pending > 0 || account.sync.state === 'syncing') text = '已存在手機，正在上傳到雲端…';
  return (
    <View style={{ backgroundColor: warn ? '#3A2A0C' : C.infoBg, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 }}>
      <Text style={{ color: warn ? '#FFE2A6' : '#C5DFF7', fontSize: 14, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { position: 'absolute', left: 16, right: 16, top: 52, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tilt: { position: 'absolute', left: 16, right: 16, top: 150, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#3A2A0C', borderWidth: 2, borderColor: C.warn, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 28, marginTop: -24, gap: 14 },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  strip: { borderRadius: 14, backgroundColor: '#000', borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  markBadge: { position: 'absolute', top: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  distBtn: { minHeight: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, gap: 6 },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: C.raised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
