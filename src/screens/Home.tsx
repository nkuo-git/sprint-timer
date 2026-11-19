import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import { distanceLabel, initial } from '../records/format';
import { personalBests } from '../records/store';
import { currentVersion } from '../update/updater';
import { UpdateSheet } from '../update/UpdateBanner';
import { Avatar, Btn, C, NUM, s } from '../ui/kit';

export type Route = 'home' | 'start' | 'finish' | 'single' | 'login' | 'account' | 'nickname' | 'history';

/** 設計稿「16 首頁：帳號入口」（原「1 模式選擇」加上登入與紀錄） */
export function Home({ go }: { go(r: Route): void }) {
  const version = currentVersion();
  const { account, service } = useAccount();
  const uid = account.user?.id ?? null;
  const mine = useMemo(() => service.store.myResults(uid), [service, uid, account.recordsRev]);
  const localRaces = useMemo(() => service.store.races().length, [service, account.recordsRev]);
  // 顯示最常跑的距離的最佳成績
  const best = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of mine) if (m.distanceM !== null) counts.set(m.distanceM, (counts.get(m.distanceM) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? personalBests(mine).get(top[0]) : undefined;
  }, [mine]);
  const fresh = mine.filter((m) => m.isNew);
  const freshBy = fresh[0]?.timedBy?.nickname;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 20, flexGrow: 1 }]}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: C.dim, fontSize: 13, letterSpacing: 1.5 }}>SPRINT TIMER</Text>
            <Text style={{ color: C.text, fontSize: 30, fontWeight: '900' }}>短跑計時</Text>
          </View>
          {uid ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`帳號：${account.nickname ?? account.user?.email}`}
              onPress={() => go('account')}
              style={({ pressed }) => [s.row, { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingLeft: 6, paddingRight: 14, maxWidth: 170 }, pressed && { opacity: 0.75 }]}
            >
              <Avatar label={initial(account.nickname)} size={36} tone="me" />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                {account.nickname ?? '帳號'}
              </Text>
            </Pressable>
          ) : account.cloudEnabled ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => go('login')}
              style={({ pressed }) => [s.row, { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: C.info, paddingHorizontal: 18 }, pressed && { opacity: 0.75 }]}
            >
              <Text style={{ color: C.infoText, fontSize: 15, fontWeight: '700' }}>登入</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[s.card, { borderRadius: 20, padding: 18, gap: 12, borderWidth: 2, borderColor: C.accent }]}>
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
          style={({ pressed }) => [s.card, { borderRadius: 20, padding: 18, gap: 12, borderWidth: 1, borderColor: C.line }, pressed && { opacity: 0.8 }]}
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
        {uid ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => go('history')}
            style={({ pressed }) => [s.card, s.row, { gap: 12, minHeight: 64, paddingVertical: 14 }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>我的紀錄</Text>
              <Text style={{ color: fresh.length ? C.infoText : C.dim, fontSize: 13 }} numberOfLines={1}>
                {fresh.length
                  ? `有 ${fresh.length} 筆新成績${freshBy ? `：${freshBy}幫你計時` : ''}`
                  : account.pending > 0
                    ? `${account.pending} 筆等待上傳`
                    : mine.length
                      ? `${mine.length} 筆成績`
                      : '還沒有成績'}
              </Text>
            </View>
            {best ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.dim, fontSize: 12 }}>{distanceLabel(best.distanceM)} 最佳</Text>
                <Text style={[NUM, { color: C.accent, fontSize: 22, fontWeight: '700' }]}>{best.official.toFixed(2)}</Text>
              </View>
            ) : null}
            <Text style={{ color: C.dim, fontSize: 22 }}>›</Text>
          </Pressable>
        ) : (
          <>
            {account.cloudEnabled ? (
              <View style={{ backgroundColor: C.infoBg, borderRadius: 16, padding: 16, gap: 12 }}>
                <Text style={{ color: '#C5DFF7', fontSize: 15, lineHeight: 24 }}>登入後成績會存到雲端，換手機也帶得走。別人幫你計時的成績也會自動出現在你的紀錄裡。</Text>
                <Btn title="用 Email 登入" onPress={() => go('login')} style={{ backgroundColor: C.info }} />
              </View>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => go('history')} style={({ pressed }) => [s.row, { minHeight: 48, justifyContent: 'space-between' }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: C.soft, fontSize: 15 }}>這支手機上的紀錄</Text>
              <Text style={[NUM, { color: C.dim, fontSize: 15 }]}>{localRaces} 筆 ›</Text>
            </Pressable>
          </>
        )}
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
