import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useFrameOutput } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * 起跑手機的相機：對著起跑線上的跑者，逐格算畫面變化量（給反應時間偵測用）。
 * 用 120fps 就夠（反應時間是參考值，精度受「相機看得到動作」本身限制）。
 */
export function StartCamera({ onEnergy, targetFps = 120 }: { onEnergy(t: number, e: number): void; targetFps?: number }) {
  const device = useCameraDevice('back');
  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    targetResolution: { width: 640, height: 480 },
    onFrame(frame) {
      'worklet';
      const g = globalThis as any;
      const p = frame.getPlanes()[0];
      const buf = new Uint8Array(p.getPixelBuffer());
      const step = 6;
      const W = p.width;
      const H = p.height;
      const n = Math.ceil(W / step) * Math.ceil(H / step);
      let prev: Uint8Array | undefined = g.__startPrev;
      if (!prev || prev.length !== n) {
        prev = new Uint8Array(n);
        g.__startPrev = prev;
        g.__startHas = false;
      }
      let sum = 0;
      let k = 0;
      for (let y = 0; y < H; y += step) {
        const off = y * p.bytesPerRow;
        for (let x = 0; x < W; x += step, k++) {
          const v = buf[off + x];
          const d = v - prev[k];
          sum += d < 0 ? -d : d;
          prev[k] = v;
        }
      }
      const t = frame.timestamp;
      frame.dispose();
      if (g.__startHas) scheduleOnRN(onEnergy, t, sum / k);
      g.__startHas = true;
    },
  });
  if (!device) return <Text style={styles.msg}>找不到後鏡頭</Text>;
  return (
    <View style={styles.wrap}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={[frameOutput]} constraints={[{ fps: targetFps }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  msg: { color: '#fff', padding: 24 },
});
