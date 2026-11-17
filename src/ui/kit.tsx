import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

/**
 * 設計稿：Claude Design「短跑計時 App 介面」https://claude.ai/artifact/UXK5fTNCPcaz6D5CiXfARX
 * 戶外跑道用：深色底、超大數字、高對比。橘色＝主要動作／終點線，藍色＝同步與資訊，紅色＝搶跑／錯誤。
 * 所有可按的東西 ≥ 56px 高。
 */
export const C = {
  bg: '#0E1116',
  card: '#181C23',
  raised: '#232833',
  line: '#2A303A',
  text: '#F2F4F7',
  soft: '#C5CBD4',
  dim: '#A3ABB8',
  faint: '#8A93A1',
  accent: '#FF7A3D',
  onAccent: '#0E1116',
  info: '#5AB0FF',
  infoText: '#8CCBFF',
  infoBg: '#12263A',
  warn: '#FFC24D',
  bad: '#FF5468',
  badText: '#FF8090',
  badBg: '#3A1218',
  ok: '#5AB0FF',
};

/** 計時數字用：等寬數字 */
export const NUM: TextStyle = { fontVariant: ['tabular-nums'] };

type BtnKind = 'primary' | 'ghost' | 'danger' | 'plain';

export function Btn({
  title,
  onPress,
  disabled,
  kind = 'primary',
  big,
  style,
  textStyle,
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  kind?: BtnKind;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        big && s.btnBig,
        kind === 'ghost' && s.ghost,
        kind === 'danger' && s.danger,
        kind === 'plain' && s.plain,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      <Text
        style={[
          s.btnText,
          big && { fontSize: 22, fontWeight: '900' },
          kind === 'ghost' && { color: C.text, fontWeight: '600' },
          kind === 'danger' && { color: C.badText },
          kind === 'plain' && { color: C.soft, fontWeight: '400' },
          textStyle,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** 左上角返回鈕 + 小標題/大標題 */
export function Header({ onBack, kicker, title, right }: { onBack?(): void; kicker?: string; title?: string; right?: React.ReactNode }) {
  return (
    <View style={[s.row, { gap: 12 }]}>
      {onBack ? <IconBtn label="返回" glyph="‹" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        {kicker ? <Text style={{ color: C.dim, fontSize: 13 }}>{kicker}</Text> : null}
        {title ? <Text style={{ color: C.text, fontSize: 20, fontWeight: '700' }}>{title}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function IconBtn({ label, glyph, onPress, translucent }: { label: string; glyph: string; onPress(): void; translucent?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.icon, translucent && { backgroundColor: 'rgba(14,17,22,0.75)', borderWidth: 0 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: C.text, fontSize: 28, lineHeight: 30, marginTop: -2 }}>{glyph}</Text>
    </Pressable>
  );
}

/** 狀態小膠囊。tone: info（藍，同步/連線）、neutral、bad、overlay（相機畫面上） */
export function Chip({ text, tone = 'neutral', dot }: { text: string; tone?: 'info' | 'neutral' | 'bad' | 'overlay'; dot?: boolean }) {
  const t = {
    info: { bg: C.infoBg, fg: C.infoText, dot: C.info },
    neutral: { bg: C.raised, fg: C.soft, dot: C.dim },
    bad: { bg: C.badBg, fg: C.badText, dot: C.bad },
    overlay: { bg: 'rgba(14,17,22,0.8)', fg: C.text, dot: C.info },
  }[tone];
  return (
    <View style={[s.chip, { backgroundColor: t.bg }]}>
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.dot }} /> : null}
      <Text style={{ color: t.fg, fontSize: 14, fontWeight: '500' }}>{text}</Text>
    </View>
  );
}

/** 小卡片：上面一行灰字標籤，下面一個值 */
export function Stat({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <View style={[s.card, { flex: 1, padding: 12, gap: 4, borderRadius: 14 }]}>
      <Text style={{ color: C.dim, fontSize: 12 }}>{label}</Text>
      <Text style={[NUM, { color: color ?? C.text, fontSize: small ? 18 : 22, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** 一排選項（例如 60m/100m/200m） */
export function Segmented<T extends string | number>({ options, value, onChange, fmt }: { options: T[]; value: T; onChange(v: T): void; fmt?: (v: T) => string }) {
  return (
    <View style={[s.row, { gap: 8 }]}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={String(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o)}
            style={({ pressed }) => [s.seg, on && { backgroundColor: C.accent, borderColor: C.accent }, pressed && { opacity: 0.75 }]}
          >
            <Text style={[NUM, { color: on ? C.onAccent : C.text, fontSize: 17, fontWeight: '700' }]}>{fmt ? fmt(o) : String(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 可點選的選項卡（例如 槍聲／閃光） */
export function ChoiceCard({ title, desc, selected, onPress }: { title: string; desc: string; selected: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [s.card, { flex: 1, padding: 14, gap: 6, borderWidth: selected ? 2 : 1, borderColor: selected ? C.accent : C.line }, pressed && { opacity: 0.8 }]}
    >
      <Text style={{ color: C.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: C.dim, fontSize: 13, lineHeight: 19 }}>{desc}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>{children}</Text>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
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

/** − 數值 + 的大按鈕（例如氣溫） */
export function BigStepper({ value, unit, step = 1, min, max, onChange, label }: { value: number; unit: string; step?: number; min: number; max: number; onChange(v: number): void; label: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <View style={[s.row, { gap: 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}減少`} onPress={() => onChange(clamp(value - step))} style={({ pressed }) => [s.stepBig, pressed && { opacity: 0.7 }]}>
        <Text style={{ color: C.text, fontSize: 24 }}>−</Text>
      </Pressable>
      <View style={[s.stepBig, { flex: 1, width: undefined }]}>
        <Text style={[NUM, { color: C.text, fontSize: 22, fontWeight: '700' }]}>
          {value} {unit}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}增加`} onPress={() => onChange(clamp(value + step))} style={({ pressed }) => [s.stepBig, pressed && { opacity: 0.7 }]}>
        <Text style={{ color: C.text, fontSize: 24 }}>+</Text>
      </Pressable>
    </View>
  );
}

/** 調整 0–1 數值的 −/+ 按鈕 */
export function Stepper({ label, value, step, onChange, fmt }: { label: string; value: number; step: number; onChange(v: number): void; fmt?: (v: number) => string }) {
  return (
    <Row>
      <Text style={[s.small, { flex: 1 }]}>{label}</Text>
      <Btn kind="ghost" title="−" onPress={() => onChange(Math.max(0, +(value - step).toFixed(4)))} style={s.step} />
      <Text style={[s.small, NUM, { width: 52, textAlign: 'center' }]}>{fmt ? fmt(value) : value.toFixed(2)}</Text>
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
  pad: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 28, gap: 18 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 10 },
  btn: { backgroundColor: C.accent, minHeight: 56, paddingHorizontal: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnBig: { minHeight: 72, borderRadius: 20 },
  ghost: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  danger: { backgroundColor: 'transparent', borderWidth: 2, borderColor: C.bad },
  plain: { backgroundColor: 'transparent' },
  btnText: { color: C.onAccent, fontSize: 17, fontWeight: '700' },
  icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  seg: { flex: 1, minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  stepBig: { width: 56, height: 56, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { color: C.text, fontSize: 15 },
  small: { color: C.text, fontSize: 13 },
  note: { color: C.faint, fontSize: 13, lineHeight: 20 },
  input: { color: C.text, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, minWidth: 80, textAlign: 'right' },
  step: { minHeight: 44, paddingHorizontal: 14 },
  big: { color: C.text, fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'] },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
});
