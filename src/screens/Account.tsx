import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import type { AccountSnapshot } from '../account/service';
import { initial } from '../records/format';
import { Avatar, Banner, Btn, C, Header, NUM, s } from '../ui/kit';

/** 同步狀態的文字與色調（帳號頁、紀錄頁、成績頁共用） */
export function syncSummary(a: AccountSnapshot, now = Date.now()): { title: string; detail: string; tone: 'info' | 'warn' | 'bad' } {
  const { sync, pending } = a;
  if (sync.state === 'syncing') return { title: '同步中…', detail: '正在和雲端對齊成績。', tone: 'info' };
  if (sync.state === 'error') return { title: '同步失敗', detail: `${sync.error ?? '雲端暫時有問題'}。成績還在手機上，稍後會再試。`, tone: 'bad' };
  if (pending > 0) {
    return {
      title: `${pending} 筆等待上傳`,
      detail: sync.state === 'offline' ? '現在沒有網路。成績先存在手機上，連上網路後會自動上傳。' : '成績先存在手機上，很快會自動上傳。',
      tone: 'warn',
    };
  }
  if (sync.state === 'offline') return { title: '現在沒有網路', detail: '連上網路後會自動同步。', tone: 'warn' };
  if (sync.lastOk === null) return { title: '尚未同步', detail: '連上網路後會自動同步。', tone: 'info' };
  const min = Math.floor((now - sync.lastOk) / 60000);
  const ago = min < 1 ? '剛剛' : min < 60 ? `${min} 分鐘前` : min < 1440 ? `${Math.floor(min / 60)} 小時前` : `${Math.floor(min / 1440)} 天前`;
  return { title: '雲端已同步', detail: `所有成績都已存到雲端 · ${ago}`, tone: 'info' };
}

/** 設計稿「20 帳號」 */
export function Account({ onBack, onHistory, onEditNickname }: { onBack(): void; onHistory(): void; onEditNickname(): void }) {
  const { account, service } = useAccount();
  const [busy, setBusy] = useState<'' | 'out' | 'delete'>('');
  const [error, setError] = useState('');
  const sync = syncSummary(account);
  const count = service.store.myResults(account.user?.id ?? null).length;
  const fg = sync.tone === 'warn' ? C.warn : sync.tone === 'bad' ? C.badText : C.infoText;
  const sub = sync.tone === 'warn' ? '#FFE2A6' : sync.tone === 'bad' ? C.badText : '#C5DFF7';
  const bg = sync.tone === 'warn' ? '#3A2A0C' : sync.tone === 'bad' ? C.badBg : C.infoBg;

  const signOut = async () => {
    setBusy('out');
    await service.signOut();
    onBack();
  };

  const confirmDelete = () =>
    Alert.alert('刪除帳號？', '雲端上你的暱稱和你計時的所有成績都會刪除，無法復原。別人幫你計時的成績會變成未標記。', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          setError('');
          try {
            await service.deleteAccount();
            onBack();
          } catch (e: any) {
            setError(e?.message ?? String(e));
            setBusy('');
          }
        },
      },
    ]);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.pad, { flexGrow: 1 }]}>
        <Header onBack={onBack} title="帳號" />

        <View style={[s.card, s.row, { borderRadius: 20, padding: 18, gap: 14 }]}>
          <Avatar label={initial(account.nickname)} size={64} tone="me" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }} numberOfLines={1}>
              {account.nickname ?? '（還沒取暱稱）'}
            </Text>
            <Text style={{ color: C.dim, fontSize: 14 }} numberOfLines={1}>
              {account.user?.email}
            </Text>
          </View>
          <Btn kind="ghost" title="改暱稱" onPress={onEditNickname} style={{ minHeight: 44, borderRadius: 12, paddingHorizontal: 14, backgroundColor: 'transparent' }} textStyle={{ fontSize: 15, fontWeight: '500' }} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${sync.title}，點一下立刻同步`}
          onPress={() => void service.refresh()}
          style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 2 }, pressed && { opacity: 0.8 }]}
        >
          <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{sync.title}</Text>
          <Text style={{ color: sub, fontSize: 13, lineHeight: 20 }}>{sync.detail}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onHistory}
          style={({ pressed }) => [s.row, { justifyContent: 'space-between', minHeight: 56, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.raised }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '500' }}>我的紀錄</Text>
          <Text style={[NUM, { color: C.dim, fontSize: 15 }]}>{count} 筆 ›</Text>
        </Pressable>

        <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>換新手機時，安裝 App 後用同一個 Email 登入，紀錄就會全部回來。</Text>
        {error ? <Banner tone="bad" text={error} /> : null}

        <View style={{ flex: 1 }} />
        <Btn kind="ghost" title={busy === 'out' ? '登出中…' : '登出'} onPress={signOut} disabled={busy !== ''} />
        <Text style={{ color: C.dim, fontSize: 13, lineHeight: 21, textAlign: 'center' }}>登出時還沒上傳的紀錄會留在這支手機，下次登入再上傳。</Text>
        <Btn kind="plain" title={busy === 'delete' ? '刪除中…' : '刪除帳號和雲端上的所有紀錄'} onPress={confirmDelete} disabled={busy !== ''} style={{ minHeight: 48 }} textStyle={{ color: C.badText, fontSize: 15 }} />
      </ScrollView>
    </View>
  );
}
