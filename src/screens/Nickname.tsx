import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import { NICKNAME_MAX, nicknameLength, nicknameProblem } from '../cloud/profile';
import { Banner, Btn, C, Header, NUM, s } from '../ui/kit';

type Check = 'idle' | 'checking' | 'ok' | 'taken' | 'unknown';

/** 設計稿「19 取暱稱」。第一次登入必填（沒有返回鍵）；從帳號頁進來是修改（onBack）。 */
export function Nickname({ onDone, onBack }: { onDone(): void; onBack?(): void }) {
  const { account, service } = useAccount();
  const [value, setValue] = useState(account.nickname ?? '');
  const [check, setCheck] = useState<Check>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const trimmed = value.trim();
  const problem = trimmed ? nicknameProblem(trimmed) : null;
  const unchanged = !!account.nickname && trimmed === account.nickname;

  // 停止打字 0.4 秒後問雲端這個暱稱有沒有人用
  useEffect(() => {
    if (!trimmed || problem || unchanged) {
      setCheck('idle');
      return;
    }
    setCheck('checking');
    let alive = true;
    const id = setTimeout(() => {
      service
        .nicknameAvailable(trimmed)
        .then((free) => alive && setCheck(free ? 'ok' : 'taken'))
        .catch(() => alive && setCheck('unknown')); // 查不到（沒網路）就先放行，儲存時雲端還會再擋一次
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [trimmed, problem, unchanged, service]);

  const save = async () => {
    if (unchanged) return onDone();
    setSaving(true);
    setError('');
    try {
      if ((await service.setNickname(trimmed)) === 'taken') setCheck('taken');
      else onDone();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const bad = !!problem || check === 'taken';
  const hint = problem ?? (check === 'taken' ? '這個暱稱已經有人用了，換一個試試' : check === 'ok' ? '可以使用' : check === 'checking' ? '檢查中…' : '');
  const canSave = !!trimmed && !bad && check !== 'checking' && !saving;
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 20, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        {onBack ? (
          <Header onBack={onBack} />
        ) : (
          <View style={[s.row, { minHeight: 48 }]}>
            <Text style={{ color: C.info, fontSize: 18, fontWeight: '900' }}>✓</Text>
            <Text style={{ color: C.infoText, fontSize: 15, flex: 1 }} numberOfLines={1}>
              已登入 {account.user?.email}
            </Text>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>{onBack ? '修改暱稱' : '取個暱稱'}</Text>
          <Text style={{ color: C.dim, fontSize: 16, lineHeight: 26 }}>成績上會顯示這個名字。別人幫你計時的時候，也是用暱稱找到你、把成績標記給你。</Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>暱稱</Text>
          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(t);
              setError('');
            }}
            maxLength={NICKNAME_MAX * 2}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => canSave && save()}
            accessibilityLabel="暱稱"
            style={{ minHeight: 60, borderRadius: 16, borderWidth: 2, borderColor: bad ? C.bad : C.info, backgroundColor: C.card, color: C.text, fontSize: 20, fontWeight: '700', paddingHorizontal: 16 }}
          />
          <View style={[s.row, { justifyContent: 'space-between', minHeight: 24 }]}>
            <Text style={{ color: bad ? C.badText : C.infoText, fontSize: 14, flex: 1 }}>{hint}</Text>
            <Text style={[NUM, { color: C.dim, fontSize: 13 }]}>
              {nicknameLength(value)} / {NICKNAME_MAX}
            </Text>
          </View>
        </View>

        <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>2 到 16 個字，不能和別人重複。之後可以在帳號頁修改。</Text>
        {error ? <Banner tone="bad" text={error} /> : null}

        <View style={{ flex: 1 }} />
        <Btn title={saving ? '儲存中…' : '完成'} onPress={save} disabled={!canSave} style={{ minHeight: 64, borderRadius: 18 }} textStyle={{ fontSize: 19, fontWeight: '900' }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
