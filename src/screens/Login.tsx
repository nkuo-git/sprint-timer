import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useAccount } from '../account/AccountContext';
import { isValidEmail, normalizeEmail } from '../cloud/client';
import { Banner, Btn, C, Header, NUM, s } from '../ui/kit';

const CODE_LEN = 6;
const RESEND_AFTER_S = 60;

/** 設計稿「17 登入：輸入 Email」與「18 登入：輸入驗證碼」 */
export function Login({ onBack, onDone }: { onBack(): void; onDone(): void }) {
  const { service } = useAccount();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(0);

  const send = async () => {
    setError('');
    setSending(true);
    try {
      await service.requestCode(email);
      setSentAt(Date.now());
      setStep('code');
      return true;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  if (step === 'code') {
    return (
      <Verify
        email={normalizeEmail(email)}
        sentAt={sentAt}
        resend={send}
        resendError={error}
        onBack={() => {
          setError('');
          setStep('email');
        }}
        onDone={onDone}
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
          <Text style={{ color: C.dim, fontSize: 16, lineHeight: 26 }}>不用密碼。我們會寄一封認證信到你的信箱，裡面有 6 位數驗證碼。</Text>
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
            onSubmitEditing={() => valid && !sending && send()}
            accessibilityLabel="Email"
            style={{ minHeight: 60, borderRadius: 16, borderWidth: 2, borderColor: C.info, backgroundColor: C.card, color: C.text, fontSize: 19, paddingHorizontal: 16 }}
          />
        </View>

        {error ? <Banner tone="bad" text={error} /> : null}
        <Btn title={sending ? '寄送中…' : '寄認證信'} onPress={send} disabled={!valid || sending} style={{ minHeight: 64, borderRadius: 18 }} textStyle={{ fontSize: 19, fontWeight: '900' }} />
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

function Verify({ email, sentAt, resend, resendError, onBack, onDone }: { email: string; sentAt: number; resend(): Promise<boolean>; resendError: string; onBack(): void; onDone(): void }) {
  const { service } = useAccount();
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [code, setCode] = useState('');
  const [state, setState] = useState<'typing' | 'checking' | 'wrong'>('typing');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const wait = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));

  const submit = async (value: string) => {
    setState('checking');
    setError('');
    try {
      await service.verifyCode(email, value);
      onDone();
    } catch (e: any) {
      // 驗證碼錯誤用畫面上固定的說明；其他狀況（沒網路、太頻繁）顯示原因
      setError(e?.kind === 'invalid' ? '' : (e?.message ?? String(e)));
      setState('wrong');
    }
  };

  const onChange = (t: string) => {
    if (state === 'checking') return;
    const digits = t.replace(/\D/g, '').slice(0, CODE_LEN);
    setCode(digits);
    setState('typing');
    if (digits.length === CODE_LEN) void submit(digits);
  };

  const again = async () => {
    setResending(true);
    setCode('');
    setState('typing');
    setError('');
    await resend();
    setResending(false);
    input.current?.focus();
  };

  const wrong = state === 'wrong';
  const canResend = (wait === 0 || wrong) && !resending && state !== 'checking';
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { gap: 20, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Header onBack={onBack} />
        <View style={{ gap: 8, paddingTop: 8 }}>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>輸入驗證碼</Text>
          <Text style={{ color: C.dim, fontSize: 16, lineHeight: 26 }}>認證信已寄到</Text>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
            {email}
          </Text>
        </View>

        <View>
          <View style={[s.row, { gap: 8 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {Array.from({ length: CODE_LEN }, (_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 68,
                  borderRadius: 14,
                  backgroundColor: C.card,
                  borderWidth: 2,
                  borderColor: wrong ? C.bad : i === code.length && state === 'typing' ? C.info : C.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[NUM, { color: wrong ? C.badText : C.text, fontSize: 32, fontWeight: '700' }]}>{code[i] ?? ''}</Text>
              </View>
            ))}
          </View>
          {/* 透明的輸入框蓋在格子上：點格子就叫出數字鍵盤，也能接手機自動填入的驗證碼 */}
          <TextInput
            ref={input}
            value={code}
            onChangeText={onChange}
            keyboardType="number-pad"
            maxLength={CODE_LEN}
            autoFocus
            caretHidden
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            accessibilityLabel="6 位數驗證碼"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: 'transparent', fontSize: 1 }}
          />
        </View>

        {wrong ? <Banner tone="bad" text={error || '驗證碼不對或已過期。請再看一次信，或重寄一封。'} /> : null}
        {state === 'checking' ? <Banner text="確認中…" /> : null}
        {state === 'typing' ? <Text style={{ color: C.dim, fontSize: 14, lineHeight: 24 }}>輸入完 6 個數字會自動登入。驗證碼 1 小時內有效。沒看到信的話，找找垃圾信件匣。</Text> : null}
        {resendError && state === 'typing' ? <Banner tone="bad" text={resendError} /> : null}

        <View style={{ gap: 4 }}>
          <Btn
            kind="ghost"
            title={resending ? '寄送中…' : canResend || wait === 0 ? '重寄認證信' : `重寄認證信（${wait} 秒後）`}
            onPress={again}
            disabled={!canResend}
            textStyle={{ fontSize: 16, fontWeight: '700' }}
          />
          <Btn kind="plain" title="換一個 Email" onPress={onBack} textStyle={{ fontSize: 16 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
