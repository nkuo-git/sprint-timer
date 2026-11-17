import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { currentVersion } from '../update/updater';
import { UpdateSheet } from '../update/UpdateBanner';
import { C, s } from '../ui/kit';

export type Route = 'home' | 'start' | 'finish' | 'single';

/** 設計稿「1 模式選擇」 */
export function Home({ go }: { go(r: Route): void }) {
  const version = currentVersion();
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 24, flexGrow: 1 }]}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: C.dim, fontSize: 13, letterSpacing: 1.5 }}>SPRINT TIMER</Text>
          <Text style={{ color: C.text, fontSize: 30, fontWeight: '900' }}>短跑計時</Text>
        </View>
        <Text style={{ color: C.dim, fontSize: 16, lineHeight: 25 }}>選擇計時方式。成績從鳴槍起算，包含反應時間。</Text>

        <View style={[s.card, { borderRadius: 20, padding: 20, gap: 14, borderWidth: 2, borderColor: C.accent }]}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>雙手機</Text>
            <View style={{ backgroundColor: C.accent, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
              <Text style={{ color: C.onAccent, fontSize: 13, fontWeight: '700' }}>最準 ±5ms</Text>
            </View>
          </View>
          <Text style={{ color: C.soft, fontSize: 15, lineHeight: 24 }}>一支在起點鳴槍，一支在終點拍衝線。可測反應時間、判斷搶跑。兩支手機要連同一個 Wi-Fi 或熱點。</Text>
          <View style={[s.row, { gap: 10 }]}>
            <Tile title="這支當起點" onPress={() => go('start')} />
            <Tile title="這支當終點" onPress={() => go('finish')} />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => go('single')}
          style={({ pressed }) => [s.card, { borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: C.line }, pressed && { opacity: 0.8 }]}
        >
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>單手機</Text>
            <View style={{ borderWidth: 1, borderColor: C.info, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
              <Text style={{ color: C.info, fontSize: 13, fontWeight: '700' }}>一個人就能用</Text>
            </View>
          </View>
          <Text style={{ color: C.soft, fontSize: 15, lineHeight: 24 }}>手機放終點，自己發令、自己拍衝線。自動扣除聲音傳到起點的時間。</Text>
        </Pressable>

        <View style={{ flex: 1 }} />
        <Text style={{ color: C.faint, fontSize: 12, textAlign: 'center' }}>{version ? `v${version}` : '開發版'}</Text>
      </ScrollView>
      <UpdateSheet />
    </View>
  );
}

function Tile({ title, onPress }: { title: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, minHeight: 56, borderRadius: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}
