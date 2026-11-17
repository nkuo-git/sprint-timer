import React from 'react';
import { View } from 'react-native';
import type { FinishRegion } from '../camera/FinishCamera';
import { Btn, Row, Stepper, s } from './kit';

export function RegionControls({ region, onChange }: { region: FinishRegion; onChange(r: FinishRegion): void }) {
  const set = (p: Partial<FinishRegion>) => onChange({ ...region, ...p });
  return (
    <View style={s.card}>
      <Stepper label="終點線位置（紅線）" value={region.lineX} step={0.01} onChange={(v) => set({ lineX: v })} />
      <Stepper label="軀幹帶上緣（肩）" value={region.y0} step={0.02} onChange={(v) => set({ y0: Math.min(v, region.y1 - 0.04) })} />
      <Stepper label="軀幹帶下緣（腰）" value={region.y1} step={0.02} onChange={(v) => set({ y1: Math.max(v, region.y0 + 0.04) })} />
      <Stepper label="分析帶寬度" value={region.band} step={0.02} onChange={(v) => set({ band: Math.max(0.04, v) })} />
      <Row>
        <Btn kind="ghost" style={{ flex: 1 }} title={region.direction === 1 ? '跑者方向：左 → 右' : '跑者方向：右 → 左'} onPress={() => set({ direction: region.direction === 1 ? -1 : 1 })} />
      </Row>
    </View>
  );
}
