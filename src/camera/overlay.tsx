import React from 'react';
import { StyleSheet, View } from 'react-native';

/** 在相機預覽上畫終點線與軀幹高度帶（座標皆為 0–1 正規化） */
export function FinishOverlay({ lineX, y0, y1, band }: { lineX: number; y0: number; y1: number; band: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.band, { left: `${(lineX - band) * 100}%`, width: `${band * 200}%`, top: `${y0 * 100}%`, height: `${(y1 - y0) * 100}%` }]} />
      <View style={[styles.line, { left: `${lineX * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: '#ff3b30' },
  band: { position: 'absolute', borderWidth: 1, borderColor: '#ffcc00', backgroundColor: 'rgba(255,204,0,0.12)' },
});
