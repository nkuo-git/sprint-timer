import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import { isLoginLink, isValidEmail } from '../cloud/client';
import { Banner, Btn, C, Header, NUM, s } from '../ui/kit';

const RESEND_AFTER_S = 60;

/** 設計稿「17 登入：輸入 Email」與「18 登入：到信箱點連結」 */
export function Login({ onBack, onDone }: { onBack(): void; onDone(): void }) {
  const { account, service } = useAccount();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(0);

  // 點了信裡的連結、登入完成：離開登入畫面
  useEffect(() => {
    if (account.user) onDone();
  }, [account.user, onDone]);
  // 離開登入畫面時，上次點連結失敗的訊息不用留著
  useEffect(() => () => service.clearLinkError(), [service]);

  const send = async (to: string) => {
    setError('');
    setSending(true);
    try {
      await service.requestLink(to);
      setSentAt(Date.now());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  };

  // 登入信已寄出（包含寄出後 App 被關掉再打開）：等使用者去點連結
  if (account.pendingEmail) {
    return (
      <CheckMail
        email={account.pendingEmail}
        sentAt={sentAt}
        resending={sending}
        resend={() => send(account.pendingEmail!)}
        resendError={error}
        onBack={() => {
          setError('');
          setEmail(account.pendingEmail ?? '');
          void service.cancelLogin();
        }}
      />
    );
  }

  const valid = isValidEmail(email);
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 20, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Header onBack={onBack} />
        <View style={{ gap: 8, paddingTop: 8 }}>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>用 Email 登入</Text>
          <Text style={{ color: C.dim, fontSize: 16, lineHeight: 26 }}>不用密碼。我們會寄一封登入信到你的信箱，在這支手機上點信裡的連結就登入了。</Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>Email</Text>
          <TextInput
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setError('');
            }}
            placeholder="you@example.com"
            placeholderTextColor={C.faint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => valid && !sending && send(email)}
            accessibilityLabel="Email"
            style={{ minHeight: 60, borderRadius: 16, borderWidth: 2, borderColor: C.info, backgroundColor: C.card, color: C.text, fontSize: 19, paddingHorizontal: 16 }}
          />
        </View>

        {account.signingIn ? <Banner text="登入中…" /> : error || account.linkError ? <Banner tone="bad" text={error || account.linkError || ''} /> : null}
        <Btn title={sending ? '寄送中…' : '寄登入信'} onPress={() => send(email)} disabled={!valid || sending} style={{ minHeight: 64, borderRadius: 18 }} textStyle={{ fontSize: 19, fontWeight: '900' }} />
        <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>第一次登入會自動建立帳號。換新手機時用同一個 Email 登入，紀錄就會回來。</Text>

        <View style={{ flex: 1 }} />
        <View style={[s.card, { paddingVertical: 14, gap: 6 }]}>
          <Text style={{ color: C.soft, fontSize: 14, fontWeight: '700' }}>會存到雲端的資料</Text>
          <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>Email、暱稱、成績（時間、距離、日期）。衝線照片和影片只留在手機上，不會上傳。</Text>
        </View>
        <Btn kind="plain" title="先不登入，繼續使用" onPress={onBack} textStyle={{ fontSize: 16 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const STEPS = ['在這支手機上打開信箱，找到剛寄來的登入信', '點信裡的「登入」連結', '手機會自動回到這裡，登入就完成了'];

/** 等使用者到信箱點連結。點了以後手機會用那個連結打開 App（AccountContext 接手登入），這個畫面只顯示狀態。 */
function CheckMail({ email, sentAt, resending, resend, resendError, onBack }: { email: string; sentAt: number; resending: boolean; resend(): Promise<void>; resendError: string; onBack(): void }) {
  const { account, service } = useAccount();
  const [now, setNow] = useState(Date.now());
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState('');
  const [pasteError, setPasteError] = useState('');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const wait = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));

  const failed = account.linkError ?? (pasteError || null);
  const busy = account.signingIn;
  const canResend = (wait === 0 || !!failed) && !resending && !busy;

  const submit = async () => {
    setPasteError('');
    if (!isLoginLink(link)) {
      setPasteError('這不是登入信裡的連結。請在信裡長按「登入」連結，複製連結網址後再貼上。');
      return;
    }
    try {
      await service.signInWithLink(link);
    } catch (e: any) {
      setPasteError(e?.message ?? String(e));
    }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 18, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Header onBack={onBack} />
        <View style={{ gap: 8, paddingTop: 8 }}>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>到信箱點登入連結</Text>
          <Text style={{ color: C.dim, fontSize: 16, lineHeight: 26 }}>登入信已寄到</Text>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
            {email}
          </Text>
        </View>

        <View style={[s.card, { gap: 14 }]}>
          {STEPS.map((text, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.infoBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[NUM, { color: C.infoText, fontSize: 15, fontWeight: '700' }]}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, color: C.text, fontSize: 16, lineHeight: 26 }}>{text}</Text>
            </View>
          ))}
        </View>

        {busy ? <Banner text="登入中…" /> : failed ? <Banner tone="bad" text={failed} /> : pasting ? null : <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>沒看到信的話，找找垃圾信件匣。連結只能用一次。</Text>}
        {resendError && !busy ? <Banner tone="bad" text={resendError} /> : null}

        {pasting ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>貼上信裡的登入連結</Text>
            <TextInput
              value={link}
              onChangeText={(t) => {
                setLink(t);
                setPasteError('');
              }}
              placeholder="長按這裡 → 貼上"
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="登入連結"
              style={{ minHeight: 56, borderRadius: 16, borderWidth: 2, borderColor: C.info, backgroundColor: C.card, color: C.text, fontSize: 16, paddingHorizontal: 16 }}
            />
            <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>在信裡長按「登入」連結 → 複製連結網址，再回到這裡貼上。</Text>
            <Btn title="登入" onPress={submit} disabled={!link.trim() || busy} style={{ minHeight: 56, borderRadius: 16 }} textStyle={{ fontSize: 17, fontWeight: '900' }} />
          </View>
        ) : null}

        <View style={{ gap: 4 }}>
          <Btn
            kind="ghost"
            title={resending ? '寄送中…' : canResend || wait === 0 ? '重寄登入信' : `重寄登入信（${wait} 秒後）`}
            onPress={() => void resend()}
            disabled={!canResend}
            textStyle={{ fontSize: 16, fontWeight: '700' }}
          />
          {!pasting && !busy ? <Btn kind="plain" title="點了連結卻沒有回到 App？" onPress={() => setPasting(true)} textStyle={{ fontSize: 16 }} /> : null}
          <Btn kind="plain" title="換一個 Email" onPress={onBack} textStyle={{ fontSize: 16 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
