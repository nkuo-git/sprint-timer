import React, { useMemo } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { decodePolyline, type LatLon } from '../core/gpsTrack';
import { clockLabel } from '../records/format';
import type { RunInput } from '../records/store';
import { averagePace, durationLabel, kmLabel, paceLabel, targetLabel } from '../run/format';
import { Btn, C, Chip, IconBtn, NUM, s } from '../ui/kit';
import { RouteMap } from '../ui/RouteMap';

export type RunSaveState = 'cloud' | 'pending' | 'local' | 'not-saved';

/** 設計稿「30 長跑：成績與路線」。跑完時和從紀錄點進來都用這一頁 */
export function RunSummary({
  run,
  save,
  personalBest,
  onBack,
  onHome,
  onAgain,
  onDelete,
}: {
  run: RunInput;
  save: RunSaveState;
  personalBest: boolean;
  onBack(): void;
  onHome(): void;
  onAgain?(): void;
  onDelete?(): void;
}) {
  const track = useMemo<LatLon[][]>(() => run.track.map(decodePolyline), [run.track]);
  const pace = averagePace(run.distanceM, run.durationS);
  const fastest = run.splitsS.length ? Math.min(...run.splitsS) : null;
  const slowest = run.splitsS.length ? Math.max(...run.splitsS) : null;
  const d = new Date(run.ranAt);
  const when = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${clockLabel(run.ranAt)} · 長跑`;
  const saveChip = {
    cloud: { text: '已存到雲端', tone: 'info' as const },
    pending: { text: '等待上傳', tone: 'neutral' as const },
    local: { text: '存在這支手機', tone: 'neutral' as const },
    'not-saved': { text: '距離太短，沒有存檔', tone: 'bad' as const },
  }[save];
  const heading = run.targetM === null ? '自由跑' : run.completed ? `${targetLabel(run.targetM)} 成績` : `目標 ${targetLabel(run.targetM)} · 沒跑完`;

  const confirmDelete = () =>
    Alert.alert('刪除這次紀錄？', '路線和成績都會刪除，雲端上的也會一起刪掉。', [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 14, flexGrow: 1 }]}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <IconBtn label="返回" glyph="‹" onPress={onBack} />
          <View style={{ alignItems: 'center', gap: 4, flex: 1 }}>
            <Text style={{ color: C.soft, fontSize: 15 }}>{when}</Text>
            <Chip dot text={saveChip.text} tone={saveChip.tone} />
          </View>
          {onDelete ? (
            <Pressable accessibilityRole="button" accessibilityLabel="刪除這次紀錄" onPress={confirmDelete} style={({ pressed }) => [s.icon, pressed && { opacity: 0.7 }]}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M4 7h16" />
                <Path d="M9 7V4h6v3" />
                <Path d="M6 7l1 13h10l1-13" />
              </Svg>
            </Pressable>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>

        {track.some((t) => t.length > 1) ? (
          <RouteMap track={track} distanceM={run.distanceM} height={250} label={`跑步路線，${kmLabel(run.distanceM)} 公里`} />
        ) : (
          <View style={{ height: 120, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Text style={{ color: C.dim, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>這次沒有記錄到路線（GPS 訊號太弱）。</Text>
          </View>
        )}

        <View style={{ alignItems: 'center', gap: 4, paddingTop: 4 }}>
          <Text style={{ color: C.dim, fontSize: 15 }}>{heading}</Text>
          <Text style={[NUM, { color: C.accent, fontSize: 88, fontWeight: '700', lineHeight: 92 }]} numberOfLines={1} adjustsFontSizeToFit>
            {durationLabel(run.durationS)}
          </Text>
          {personalBest ? (
            <View style={{ marginTop: 6, backgroundColor: C.warn, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 }}>
              <Text style={{ color: C.onAccent, fontSize: 14, fontWeight: '700' }}>{targetLabel(run.targetM)} 個人最佳</Text>
            </View>
          ) : null}
        </View>

        <View style={[s.row, { gap: 8, alignItems: 'stretch' }]}>
          <SmallStat label="GPS 距離" value={`${kmLabel(run.distanceM)} km`} />
          <SmallStat label="平均配速" value={paceLabel(pace)} />
          <SmallStat label="最快一公里" value={paceLabel(fastest)} />
        </View>

        {run.splitsS.length ? (
          <View>
            <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700', paddingBottom: 6 }}>每公里</Text>
            {run.splitsS.map((sec, i) => {
              const fast = sec === fastest;
              // 長條：最慢的一公里最短、最快的最長（看得出哪裡跑得快）
              const span = slowest! - fastest!;
              const w = span > 0 ? 0.55 + (0.45 * (slowest! - sec)) / span : 0.9;
              return (
                <View key={i} style={[s.row, { gap: 12, minHeight: 40, borderTopWidth: 1, borderTopColor: C.raised }]}>
                  <Text style={[NUM, { width: 22, color: C.dim, fontSize: 15, fontWeight: '700' }]}>{i + 1}</Text>
                  <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: C.card }}>
                    <View style={{ width: `${Math.round(w * 100)}%`, height: 10, borderRadius: 5, backgroundColor: fast ? C.accent : '#3A4252' }} />
                  </View>
                  <Text style={[NUM, { width: 64, textAlign: 'right', color: fast ? C.accent : C.text, fontSize: 18, fontWeight: '700' }]}>{paceLabel(sec)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={{ flex: 1 }} />
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="ghost" title="回首頁" onPress={onHome} style={{ flex: 1, minHeight: 64, borderRadius: 18 }} textStyle={{ fontSize: 18 }} />
          {onAgain ? <Btn title="再跑一次" onPress={onAgain} style={{ flex: 1, minHeight: 64, borderRadius: 18 }} textStyle={{ fontSize: 18, fontWeight: '900' }} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={[s.card, { flex: 1, padding: 12, gap: 4, borderRadius: 14 }]}>
      <Text style={{ color: C.dim, fontSize: 12 }}>{label}</Text>
      <Text style={[NUM, { color: C.text, fontSize: 20, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}
