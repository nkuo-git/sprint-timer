import React, { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import {
  armDetector,
  createDetectorState,
  processFrame,
  startLearning,
  type Crossing,
  type DetectorState,
} from '../core/finishLine';
import { PrecisionClock } from '../../modules/precision-clock';
import { FinishOverlay } from './overlay';

export interface FinishRegion {
  /** 0–1，畫面座標（預覽與影格都已轉正） */
  lineX: number;
  y0: number;
  y1: number;
  /** 分析帶半寬（0–1） */
  band: number;
  direction: 1 | -1;
}

export const defaultRegion: FinishRegion = { lineX: 0.5, y0: 0.35, y1: 0.6, band: 0.12, direction: 1 };

export interface FinishCameraHandle {
  /** 學習背景（跑道淨空時），學完自動進入待命 */
  learnAndArm(): void;
  stop(): void;
}

export interface Telemetry {
  fps: number;
  phase: string;
  /** 影格時間戳和 PrecisionClock.now() 的差（秒）。應在 0–0.2 之間，否則時基不一致 */
  lag: number;
}

interface Props {
  region: FinishRegion;
  targetFps: number;
  torch?: boolean;
  onCross(c: Crossing): void;
  onArmed?(): void;
  onTelemetry?(t: Telemetry): void;
}

const CMD_LEARN = 1;
const CMD_STOP = 3;

export const FinishCamera = forwardRef<FinishCameraHandle, Props>(function FinishCamera(
  { region, targetFps, torch, onCross, onArmed, onTelemetry },
  ref,
) {
  const device = useCameraDevice('back');
  // 指令通道：JS → frame processor 執行緒。值 = 序號*10 + 指令碼
  const cmd = useMemo(() => createSynchronizable(0), []);
  const [seq, setSeq] = useState(1);

  useImperativeHandle(ref, () => ({
    learnAndArm() {
      cmd.setBlocking(seq * 10 + CMD_LEARN);
      setSeq(seq + 1);
    },
    stop() {
      cmd.setBlocking(seq * 10 + CMD_STOP);
      setSeq(seq + 1);
    },
  }));

  const handleTelemetry = (fps: number, phase: string, frameT: number) => {
    onTelemetry?.({ fps, phase, lag: PrecisionClock.now() - frameT });
  };

  const { lineX, y0, y1, band, direction } = region;
  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    // 把影格實體轉正，這樣畫面座標 = 影格座標，終點線一定是「直的欄」
    enablePhysicalBufferRotation: true,
    targetResolution: { width: 1280, height: 720 },
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      const g = globalThis as any;
      const planes = frame.getPlanes();
      const yPlane = planes[0];
      const W = yPlane.width;
      const H = yPlane.height;
      const key = `${W}x${H}:${lineX}:${y0}:${y1}:${band}:${direction}`;
      if (g.__finishKey !== key) {
        g.__finishSt = createDetectorState(W, H, {
          lineX: Math.round(lineX * W),
          y0: Math.round(y0 * H),
          y1: Math.round(y1 * H),
          bandHalfWidth: Math.max(20, Math.round(band * W)),
          direction,
        });
        g.__finishKey = key;
      }
      const st = g.__finishSt as DetectorState;
      const c = cmd.getDirty();
      if (c !== g.__finishCmd) {
        g.__finishCmd = c;
        const code = c % 10;
        if (code === CMD_LEARN) startLearning(st);
        else if (code === CMD_STOP) st.phase = 'idle';
      }
      const t = frame.timestamp;
      const res = processFrame(st, {
        t,
        width: W,
        height: H,
        stride: yPlane.bytesPerRow,
        luma: new Uint8Array(yPlane.getPixelBuffer()),
      });
      frame.dispose();
      if (st.phase === 'learning' && st.bgCount >= 15) {
        armDetector(st);
        if (onArmed) scheduleOnRN(onArmed);
      }
      if (res) scheduleOnRN(onCross, res);
      // 每 ~0.25 秒回報一次狀態
      if (!(t - (g.__finishTel ?? 0) < 0.25)) {
        g.__finishTel = t;
        scheduleOnRN(handleTelemetry, 1 / st.dtEstimate, st.phase, t);
      }
    },
  });

  if (!device) return <Text style={styles.msg}>找不到後鏡頭</Text>;
  return (
    <View style={styles.wrap}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={[frameOutput]}
        constraints={[{ fps: targetFps }]}
        torchMode={torch ? 'on' : 'off'}
        resizeMode="contain"
      />
      <FinishOverlay lineX={lineX} y0={y0} y1={y1} band={band} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  msg: { color: '#fff', padding: 24 },
});
