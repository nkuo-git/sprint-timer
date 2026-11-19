import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import type { Person } from '../cloud/profile';
import { dayLabel, distanceLabel, initial } from '../records/format';
import type { Runner } from '../records/types';
import { Avatar, Btn, C, IconBtn, NUM, s } from './kit';

export interface PickTarget {
  place: number;
  /** 正式成績（秒） */
  official: number;
  distanceM: number | null;
  current: Runner | null;
  /** 衝線瞬間截圖；事後從紀錄裡標記時沒有 */
  thumbUri?: string;
}

type Search = { state: 'idle' } | { state: 'loading' } | { state: 'done'; people: Person[] } | { state: 'error'; message: string };

/**
 * 設計稿「23 選擇跑者」：從下方滑出的面板。
 * 可選自己、最近一起跑的人、用暱稱或完整 Email 搜尋用戶；不是用戶的人只寫名字。
 */
export function PickRunner({ target, onPick, onClose }: { target: PickTarget | null; onPick(runner: Runner | null): void; onClose(): void }) {
  const { account, service } = useAccount();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const signedIn = !!account.user;
  const q = query.trim();

  // 面板每次打開（或換成另一位跑者）時清空搜尋。target 物件每次重畫都是新的，所以用內容當 key，
  // 不然背景同步造成的重畫會把打到一半的字清掉。
  const open = !!target;
  const openKey = target ? `${target.place}|${target.official}` : null;
  useEffect(() => {
    if (!target) return;
    setQuery(target.current?.kind === 'name' ? target.current.name : '');
    setSearch({ state: 'idle' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  // 停止打字 0.3 秒後搜尋用戶（要登入才能搜尋）
  useEffect(() => {
    if (!open || !signedIn || !q) {
      setSearch({ state: 'idle' });
      return;
    }
    setSearch({ state: 'loading' });
    let alive = true;
    const id = setTimeout(() => {
      service
        .searchPeople(q)
        .then((people) => alive && setSearch({ state: 'done', people }))
        .catch((e) => alive && setSearch({ state: 'error', message: e?.message ?? String(e) }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, signedIn, open, service]);

  if (!target) return null;
  const recent = service.store.data.recent;
  const pickUser = (p: Person) => onPick({ kind: 'user', id: p.id, nickname: p.nickname });

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel="關閉" style={{ height: 96, backgroundColor: 'rgba(5,7,10,0.7)' }} onPress={onClose} />
        <View style={{ flex: 1, backgroundColor: 'rgba(5,7,10,0.7)' }}>
          <View style={{ flex: 1, backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 20, paddingBottom: 28, gap: 14 }}>
            <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.line }} />

            <View style={[s.row, { gap: 12 }]}>
              {target.thumbUri ? (
                <Image source={{ uri: target.thumbUri }} style={{ width: 56, height: 56, borderRadius: 10 }} resizeMode="cover" accessibilityLabel="衝線瞬間" />
              ) : (
                <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={[NUM, { color: C.soft, fontSize: 22, fontWeight: '700' }]}>{target.place}</Text>
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: C.text, fontSize: 20, fontWeight: '700' }}>第 {target.place} 位是誰？</Text>
                <Text style={[NUM, { color: C.dim, fontSize: 14 }]}>
                  {distanceLabel(target.distanceM)} · {target.official.toFixed(2)}
                </Text>
              </View>
              <IconBtn label="關閉" glyph="×" onPress={onClose} />
            </View>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={signedIn ? '搜尋暱稱，或輸入對方的 Email' : '輸入名字'}
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={signedIn ? '搜尋暱稱或 Email' : '名字'}
              style={{ minHeight: 56, borderRadius: 16, borderWidth: 2, borderColor: q ? C.info : C.line, backgroundColor: C.bg, color: C.text, fontSize: 17, paddingHorizontal: 14 }}
            />

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
              {!q ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onPick({ kind: 'self' })}
                    style={({ pressed }) => [s.row, { gap: 12, minHeight: 60, backgroundColor: C.raised, borderRadius: 16, paddingHorizontal: 14 }, pressed && { opacity: 0.75 }]}
                  >
                    <Avatar label={initial(account.nickname ?? '我')} size={40} tone="me" />
                    <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', flex: 1 }}>我自己</Text>
                    {account.nickname ? <Text style={{ color: C.dim, fontSize: 14 }}>{account.nickname}</Text> : null}
                  </Pressable>
                  {signedIn && recent.length ? (
                    <View>
                      <Text style={{ color: C.soft, fontSize: 14, fontWeight: '700', paddingBottom: 6 }}>最近一起跑的人</Text>
                      {recent.map((p) => (
                        <PersonRow key={p.id} person={p} note={dayLabel(p.at).split(' · ')[0]} onPress={() => pickUser(p)} />
                      ))}
                    </View>
                  ) : null}
                  {!signedIn && account.cloudEnabled ? <Text style={s.note}>登入後可以把成績標記給其他用戶，對方會在自己的紀錄裡看到。</Text> : null}
                </>
              ) : null}

              {q && signedIn && search.state === 'loading' ? <Text style={{ color: C.dim, fontSize: 15 }}>搜尋中…</Text> : null}
              {q && search.state === 'done' && search.people.length ? (
                <View>
                  <Text style={{ color: C.soft, fontSize: 14, fontWeight: '700', paddingBottom: 6 }}>符合「{q}」的用戶</Text>
                  {search.people.map((p) => (
                    <PersonRow key={p.id} person={p} note={recent.some((r) => r.id === p.id) ? '一起跑過' : ''} onPress={() => pickUser(p)} />
                  ))}
                </View>
              ) : null}
              {q && search.state === 'done' && !search.people.length ? (
                <View style={{ backgroundColor: C.bg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 6 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>找不到「{q}」</Text>
                  <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>對方要先登入並取好暱稱才找得到。也可以輸入對方完整的 Email。先寫名字也行，之後再回來標記。</Text>
                </View>
              ) : null}
              {q && search.state === 'error' ? (
                <View style={{ backgroundColor: C.bg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 6 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>現在無法搜尋</Text>
                  <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>{search.message}。可以先寫名字，之後再回來標記。</Text>
                </View>
              ) : null}
            </ScrollView>

            <Btn kind="ghost" title={q ? `不是用戶，只寫名字「${q}」` : '不是用戶，只寫名字'} onPress={() => onPick({ kind: 'name', name: q })} disabled={!q} style={{ backgroundColor: 'transparent' }} textStyle={{ fontSize: 16, fontWeight: '700' }} />
            {target.current ? <Btn kind="plain" title="取消這位的標記" onPress={() => onPick(null)} style={{ minHeight: 48 }} textStyle={{ color: C.badText, fontSize: 15 }} /> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PersonRow({ person, note, onPress }: { person: Person; note: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.row, { gap: 12, minHeight: 60, borderTopWidth: 1, borderTopColor: C.line }, pressed && { opacity: 0.7 }]}>
      <Avatar label={initial(person.nickname)} size={40} />
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', flex: 1 }} numberOfLines={1}>
        {person.nickname}
      </Text>
      {note ? <Text style={{ color: C.dim, fontSize: 13 }}>{note}</Text> : null}
    </Pressable>
  );
}

/** 成績列上的標記膠囊：已標記顯示頭像與名字，未標記顯示「這是誰？」 */
export function RunnerPill({ runner, selfNickname, onPress, disabled }: { runner: Runner | null; selfNickname: string | null; onPress(): void; disabled?: boolean }) {
  if (!runner) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="標記這位跑者是誰"
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [s.row, { alignSelf: 'flex-start', gap: 6, minHeight: 44, borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', borderColor: C.info, paddingHorizontal: 14 }, (pressed || disabled) && { opacity: 0.6 }]}
      >
        <Text style={{ color: C.infoText, fontSize: 18, fontWeight: '700' }}>+</Text>
        <Text style={{ color: C.infoText, fontSize: 15, fontWeight: '700' }}>這是誰？</Text>
      </Pressable>
    );
  }
  const name = runner.kind === 'self' ? (selfNickname ? `${selfNickname}（我）` : '我') : runner.kind === 'user' ? runner.nickname : runner.name;
  const tone = runner.kind === 'self' ? 'me' : runner.kind === 'user' ? 'user' : 'none';
  const letter = runner.kind === 'self' ? initial(selfNickname ?? '我') : initial(name);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}，點一下更換`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.row, { alignSelf: 'flex-start', maxWidth: '100%', gap: 8, minHeight: 44, borderRadius: 999, backgroundColor: C.raised, paddingLeft: 5, paddingRight: 14 }, pressed && { opacity: 0.7 }]}
    >
      <Avatar label={letter} size={34} tone={tone} />
      <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

