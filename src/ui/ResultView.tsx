import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { officialTime } from '../core/physics';
import { Btn, C, Header, NUM, Stat, s } from './kit';

export interface RunRecord {
  /** 第幾趟（1 起算） */
  n: number;
  /** 成績（秒），搶跑時為 null */
  raw: number | null;
}

/** 設計稿「5 成績」：大字成績、明細、今天的紀錄 */
export function ResultView({
  raw,
  reaction,
  falseStart,
  uncertainty,
  context,
  cameraFps,
  history,
  onAgain,
  onHome,
  notes,
}: {
  raw: number;
  reaction?: number;
  falseStart?: boolean;
  uncertainty?: number;
  context: string;
  cameraFps?: number;
  history: RunRecord[];
  onAgain(): void;
  onHome(): void;
  notes?: string[];
}) {
  const valid = history.filter((h) => h.raw !== null).map((h) => h.raw as number);
  const isPB = !falseStart && valid.length >= 2 && raw <= Math.min(...valid);
  const current = history.length ? history[history.length - 1].n : 1;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 16, flexGrow: 1 }]}>
        <Header onBack={onHome} kicker={`第 ${current} 趟 · ${context}`} />
        <View style={{ alignItems: 'center', gap: 4, paddingTop: 8 }}>
          <Text style={{ color: C.dim, fontSize: 15 }}>{falseStart ? '搶跑（不計）' : '成績'}</Text>
          <Text style={[NUM, { color: falseStart ? C.badText : C.accent, fontSize: 96, fontWeight: '700', lineHeight: 104 }]} adjustsFontSizeToFit numberOfLines={1}>
            {officialTime(raw).toFixed(2)}
          </Text>
          <Text style={[NUM, { color: C.dim, fontSize: 15 }]}>原始 {raw.toFixed(3)} s · 依規則進位到 0.01</Text>
          {isPB ? (
            <View style={{ marginTop: 8, backgroundColor: C.warn, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 }}>
              <Text style={{ color: C.onAccent, fontSize: 14, fontWeight: '700' }}>今天最佳</Text>
            </View>
          ) : null}
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <Stat small label="反應時間" value={reaction !== undefined ? reaction.toFixed(3) : '—'} color={falseStart ? C.badText : undefined} />
          <Stat small label="誤差約" value={uncertainty !== undefined ? `±${(uncertainty * 1000).toFixed(1)}ms` : '—'} />
          <Stat small label="相機" value={cameraFps ? `${Math.round(cameraFps)}fps` : '—'} />
        </View>
        {notes?.length ? (
          <View style={{ gap: 4 }}>
            {notes.map((n) => (
              <Text key={n} style={s.note}>
                {n}
              </Text>
            ))}
          </View>
        ) : null}
        {history.length > 1 ? (
          <View>
            <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700', paddingBottom: 6 }}>今天</Text>
            {[...history].reverse().map((h) => (
              <View key={h.n} style={[s.row, { justifyContent: 'space-between', minHeight: 44, borderTopWidth: 1, borderTopColor: C.raised }]}>
                <Text style={{ color: C.dim, fontSize: 14 }}>第 {h.n} 趟</Text>
                <Text style={[NUM, { fontSize: 18, fontWeight: '700', color: h.raw === null ? C.badText : h.n === current ? C.accent : C.text }]}>
                  {h.raw === null ? '搶跑' : officialTime(h.raw).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="ghost" title="回首頁" onPress={onHome} style={{ flex: 1, minHeight: 64 }} />
          <Btn title="再跑一趟" onPress={onAgain} style={{ flex: 1, minHeight: 64 }} textStyle={{ fontSize: 18, fontWeight: '900' }} />
        </View>
      </ScrollView>
    </View>
  );
}
