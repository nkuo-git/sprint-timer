import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Camera, useCameraDevice, useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { createEngine, engineArm, engineStep, engineStop, engineTap, type EngineState, type FinishEvent } from '../core/multiFinish';
import { PrecisionClock } from '../../modules/precision-clock';
import { viewToFrame, type ResizeMode } from './mapping';

/**
 * 手持、多人終點相機（只負責相機與辨識，不含任何介面樣式；覆蓋層由 children 提供）。
 *
 * 流程：使用者點畫面上的終點線 → onEvent 收到 'line'（found/locked 與線的位置）
 *      → 呼叫 ref.arm()（學背景約 0.4 秒）→ 'armed' → 之後每位跑者通過會收到 'runner'，
 *        終點攝影條以 'strip' 片段陸續送來 → ref.stop() 結束並送出剩餘資料。
 * 手機要直拿（終點線在畫面中是直的）。
 */
export interface MultiFinishHandle {
  /** 以影格正規化座標（0–1）指定終點線位置；通常不用自己呼叫，點畫面即可 */
  tap(nx: number, ny: number): void;
  /** 學背景並開始記錄。需要先鎖定終點線 */
  arm(): void;
  stop(): void;
}

export interface MultiTelemetry {
  fps: number;
  /** 影格尺寸（已轉正），換算座標用 */
  frameW: number;
  frameH: number;
  /** 影格時間戳和 PrecisionClock.now() 的差（秒），應在 0–0.3 之間 */
  lag: number;
}

interface Props {
  targetFps: number;
  torch?: boolean;
  resizeMode?: ResizeMode;
  /** 點畫面設定終點線（預設開） */
  tapToSetLine?: boolean;
  onEvent(e: FinishEvent): void;
  onTelemetry?(t: MultiTelemetry): void;
  children?: React.ReactNode;
}

const CMD_TAP = 1;
const CMD_ARM = 2;
const CMD_STOP = 3;

export const MultiFinishCamera = forwardRef<MultiFinishHandle, Props>(function MultiFinishCamera(
  { targetFps, torch, resizeMode = 'cover', tapToSetLine = true, onEvent, onTelemetry, children },
  ref,
) {
  const device = useCameraDevice('back');
  // 指令通道：JS → frame processor 執行緒。cmd = 序號*10 + 指令碼
  const cmd = useMemo(() => createSynchronizable(0), []);
  const tapX = useMemo(() => createSynchronizable(0.5), []);
  const tapY = useMemo(() => createSynchronizable(0.5), []);
  const seq = useRef(1);
  const view = useRef({ w: 0, h: 0 });
  const frameSize = useRef({ w: 0, h: 0 });
  const [, setTick] = useState(0);

  const send = (code: number) => {
    cmd.setBlocking(seq.current * 10 + code);
    seq.current += 1;
  };
  const tap = (nx: number, ny: number) => {
    tapX.setBlocking(nx);
    tapY.setBlocking(ny);
    send(CMD_TAP);
  };
  useImperativeHandle(ref, () => ({ tap, arm: () => send(CMD_ARM), stop: () => send(CMD_STOP) }));

  const handleTelemetry = (fps: number, frameT: number, w: number, h: number) => {
    if (frameSize.current.w !== w || frameSize.current.h !== h) {
      frameSize.current = { w, h };
      setTick((x) => x + 1);
    }
    onTelemetry?.({ fps, frameW: w, frameH: h, lag: PrecisionClock.now() - frameT });
  };

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    // 影格實體轉正：畫面座標 = 影格座標
    enablePhysicalBufferRotation: true,
    targetResolution: { width: 1280, height: 720 },
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      const g = globalThis as any;
      if (!g.__mfEngine) g.__mfEngine = createEngine();
      const eng = g.__mfEngine as EngineState;
      const yPlane = frame.getPlanes()[0];
      const t = frame.timestamp;
      const f = { t, width: yPlane.width, height: yPlane.height, stride: yPlane.bytesPerRow, luma: new Uint8Array(yPlane.getPixelBuffer()) };
      const c = cmd.getDirty();
      if (c !== g.__mfCmd) {
        g.__mfCmd = c;
        const code = c % 10;
        if (code === CMD_TAP) engineTap(eng, f, tapX.getDirty(), tapY.getDirty());
        else if (code === CMD_ARM) engineArm(eng);
        else if (code === CMD_STOP) engineStop(eng);
      }
      const evs = engineStep(eng, f);
      const w = f.width;
      const h = f.height;
      frame.dispose();
      for (let i = 0; i < evs.length; i++) scheduleOnRN(onEvent, evs[i]);
      if (!(t - (g.__mfTel ?? 0) < 0.5)) {
        g.__mfTel = t;
        scheduleOnRN(handleTelemetry, 1 / eng.dt, t, w, h);
      }
    },
  });

  const onLayout = (e: LayoutChangeEvent) => {
    view.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };

  if (!device) return <Text style={styles.msg}>找不到後鏡頭</Text>;
  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={[frameOutput]}
        constraints={[{ fps: targetFps }]}
        torchMode={torch ? 'on' : 'off'}
        resizeMode={resizeMode}
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        disabled={!tapToSetLine}
        onPress={(e) => {
          const fs = frameSize.current;
          if (!fs.w || !view.current.w) return;
          const p = viewToFrame(e.nativeEvent.locationX, e.nativeEvent.locationY, view.current.w, view.current.h, fs.w, fs.h, resizeMode);
          if (p) tap(p.x, p.y);
        }}
      />
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  msg: { color: '#fff', padding: 24 },
});
