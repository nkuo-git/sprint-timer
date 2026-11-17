import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

export const C = { bg: '#0f1115', card: '#1a1d24', text: '#f2f3f5', dim: '#9aa0aa', accent: '#ff5a1f', ok: '#34c759', bad: '#ff3b30' };

export function Btn({ title, onPress, disabled, kind = 'primary', style }: { title: string; onPress(): void; disabled?: boolean; kind?: 'primary' | 'ghost'; style?: ViewStyle }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, kind === 'ghost' && s.ghost, disabled && { opacity: 0.4 }, pressed && { opacity: 0.7 }, style]}
    >
      <Text style={[s.btnText, kind === 'ghost' && { color: C.text }]}>{title}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.row, style]}>{children}</View>;
}

export function Label({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <Text style={[s.label, dim && { color: C.dim }]}>{children}</Text>;
}

export function NumField({ label, value, onChange, unit }: { label: string; value: number; onChange(v: number): void; unit?: string }) {
  return (
    <Row>
      <Text style={[s.label, { flex: 1 }]}>{label}</Text>
      <TextInput
        style={s.input}
        keyboardType="decimal-pad"
        defaultValue={String(value)}
        onEndEditing={(e) => {
          const v = parseFloat(e.nativeEvent.text);
          if (!isNaN(v)) onChange(v);
        }}
      />
      {unit ? <Text style={s.label}>{unit}</Text> : null}
    </Row>
  );
}

/** 調整 0–1 數值的 −/+ 按鈕 */
export function Stepper({ label, value, step, onChange, fmt }: { label: string; value: number; step: number; onChange(v: number): void; fmt?: (v: number) => string }) {
  return (
    <Row>
      <Text style={[s.small, { flex: 1 }]}>{label}</Text>
      <Btn kind="ghost" title="−" onPress={() => onChange(Math.max(0, +(value - step).toFixed(4)))} style={s.step} />
      <Text style={[s.small, { width: 52, textAlign: 'center' }]}>{fmt ? fmt(value) : value.toFixed(2)}</Text>
      <Btn kind="ghost" title="+" onPress={() => onChange(Math.min(1, +(value + step).toFixed(4)))} style={s.step} />
    </Row>
  );
}

export function BigTime({ seconds, sub }: { seconds: number; sub?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 8 }}>
      <Text style={s.big}>{seconds.toFixed(3)}</Text>
      {sub ? <Text style={s.label}>{sub}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, gap: 10 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 8 },
  btn: { backgroundColor: C.accent, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3a3f4a' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: C.text, fontSize: 15 },
  small: { color: C.text, fontSize: 13 },
  input: { color: C.text, borderWidth: 1, borderColor: '#3a3f4a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 80, textAlign: 'right' },
  step: { paddingVertical: 4, paddingHorizontal: 12 },
  big: { color: C.text, fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'] },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
});
