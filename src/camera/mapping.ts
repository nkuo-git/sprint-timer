/**
 * 相機預覽（view）座標 ↔ 影格正規化座標（0–1）的換算。
 * 預覽用 'cover' 時影像會被放大裁切，'contain' 時會留邊；兩種都以中心對齊。
 */
export type ResizeMode = 'cover' | 'contain';

function layout(viewW: number, viewH: number, frameW: number, frameH: number, mode: ResizeMode) {
  const sx = viewW / frameW;
  const sy = viewH / frameH;
  const scale = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return { scale, ox: (viewW - frameW * scale) / 2, oy: (viewH - frameH * scale) / 2 };
}

/** 點擊位置（view px）→ 影格正規化座標。點在影像外回傳 null */
export function viewToFrame(px: number, py: number, viewW: number, viewH: number, frameW: number, frameH: number, mode: ResizeMode): { x: number; y: number } | null {
  const { scale, ox, oy } = layout(viewW, viewH, frameW, frameH, mode);
  const x = (px - ox) / (frameW * scale);
  const y = (py - oy) / (frameH * scale);
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** 影格正規化座標 → view px（畫終點線、跑者框用） */
export function frameToView(x: number, y: number, viewW: number, viewH: number, frameW: number, frameH: number, mode: ResizeMode): { x: number; y: number } {
  const { scale, ox, oy } = layout(viewW, viewH, frameW, frameH, mode);
  return { x: ox + x * frameW * scale, y: oy + y * frameH * scale };
}
