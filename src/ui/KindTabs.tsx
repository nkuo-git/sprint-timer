import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { fileStorage } from '../storage/fileStorage';
import { C } from './kit';

/** 短跑／長跑。首頁和我的紀錄共用同一個選擇，App 會記得上次停在哪一個 */
export type Kind = 'sprint' | 'long';

const file = fileStorage('home-tab.json');

export async function loadKind(): Promise<Kind> {
  try {
    return (await file.load())?.includes('long') ? 'long' : 'sprint';
  } catch {
    return 'sprint';
  }
}

export function saveKind(kind: Kind) {
  void file.save(JSON.stringify(kind)).catch(() => undefined);
}

/** 設計稿「27／31」上方的分頁切換 */
export function KindTabs({ value, onChange, icons }: { value: Kind; onChange(k: Kind): void; icons?: boolean }) {
  const tab = (k: Kind, title: string) => {
    const on = value === k;
    const fg = on ? C.onAccent : C.soft;
    return (
      <Pressable
        key={k}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => onChange(k)}
        style={({ pressed }) => [{ flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: on ? C.accent : 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, pressed && !on && { opacity: 0.7 }]}
      >
        {icons ? (
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {k === 'sprint' ? (
              <>
                <Path d="M5 20V4" />
                <Path d="M5 4h12l-2 4 2 4H5" />
              </>
            ) : (
              <>
                <Path d="M5 19c3-1 3-5 6-6s3-5 6-6" />
                <Circle cx={5} cy={19} r={1.6} />
                <Circle cx={18} cy={6} r={2.4} />
              </>
            )}
          </Svg>
        ) : null}
        <Text style={{ color: fg, fontSize: 18, fontWeight: '700' }}>{title}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 4 }}>
      {tab('sprint', '短跑')}
      {tab('long', '長跑')}
    </View>
  );
}
