import React, { useMemo, useState } from 'react';
import { Image, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import type { LatLon } from '../core/gpsTrack';
import { fitViewport, kmMarks, MAP_ATTRIBUTION, TILE, tilesFor, tileUrl, toScreen, trackPath } from '../run/mapView';
import { C } from './kit';

/**
 * 設計稿「28／29／30」的地圖：深色底圖（沒網路時就是深色底）＋橘色路線。
 * 起點白點、終點橘點、每公里一個號碼；跑步中顯示目前位置。不能拖曳縮放，永遠自動把整條路線放進畫面。
 */
export function RouteMap({
  track,
  position,
  distanceM,
  height,
  marks = true,
  live = false,
  accuracyM,
  label,
  style,
}: {
  track: LatLon[][];
  /** 目前位置（跑步中、準備畫面） */
  position?: LatLon | null;
  /** 用來算每公里標記 */
  distanceM?: number;
  /** 不給的話用 style 撐開的高度（例如 flex: 1） */
  height?: number;
  marks?: boolean;
  /** 跑步中：最後一點畫成「目前位置」，不畫終點 */
  live?: boolean;
  /** 準備畫面：目前位置外圈畫出定位誤差範圍 */
  accuracyM?: number | null;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState({ width: 0, height: height ?? 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((old) => (Math.round(w) === old.width && Math.round(h) === old.height ? old : { width: Math.round(w), height: Math.round(h) }));
  };
  const { width } = size;
  const boxH = size.height;
  const segments = useMemo(() => track.filter((s) => s.length > 0), [track]);
  const points = useMemo(() => {
    const all = segments.flat();
    if (position) all.push(position);
    return all;
  }, [segments, position]);
  const view = useMemo(() => fitViewport(points, width, boxH, live ? 36 : 28), [points, width, boxH, live]);
  const tiles = useMemo(() => (view ? tilesFor(view) : []), [view]);
  const km = useMemo(() => (marks && distanceM ? kmMarks(segments, distanceM) : []), [marks, segments, distanceM]);

  const first = segments[0]?.[0];
  const lastSeg = segments[segments.length - 1];
  const last = lastSeg?.[lastSeg.length - 1];
  const at = (p: LatLon) => (view ? toScreen(view, p[0], p[1]) : [0, 0]);
  // 定位誤差畫成圓：這個縮放等級一公尺幾個像素
  const metersPx = view ? (TILE * 2 ** view.zoom) / (40075016.7 * Math.cos(((position?.[0] ?? 0) * Math.PI) / 180)) : 0;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={onLayout} style={[{ height: height ?? undefined, borderRadius: 18, overflow: 'hidden', backgroundColor: '#151A21' }, style]}>
      {tiles.map((t) => (
        <Image key={`${t.z}/${t.x}/${t.y}/${t.left}`} source={{ uri: tileUrl(t) }} style={{ position: 'absolute', left: t.left, top: t.top, width: TILE, height: TILE }} />
      ))}
      {view ? (
        <Svg width={width} height={boxH} style={{ position: 'absolute', left: 0, top: 0 }}>
          {position && accuracyM ? <Circle cx={at(position)[0]} cy={at(position)[1]} r={Math.max(14, accuracyM * metersPx)} fill="rgba(90,176,255,0.16)" stroke="rgba(90,176,255,0.5)" strokeWidth={1} /> : null}
          <Path d={trackPath(view, segments)} stroke={C.accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {km.map((p, i) => {
            const [x, y] = at(p);
            return (
              <G key={i}>
                <Circle cx={x} cy={y} r={9} fill={C.bg} stroke={C.accent} strokeWidth={1.5} />
                <SvgText x={x} y={y + 4} fontSize={11} fontWeight="700" fill={C.text} textAnchor="middle">
                  {String(i + 1)}
                </SvgText>
              </G>
            );
          })}
          {first ? <Circle cx={at(first)[0]} cy={at(first)[1]} r={7} fill={C.text} stroke={C.bg} strokeWidth={2} /> : null}
          {!live && last && segments.length ? <Circle cx={at(last)[0]} cy={at(last)[1]} r={7} fill={C.accent} stroke={C.bg} strokeWidth={2} /> : null}
          {live && position ? (
            <G>
              {segments.length ? <Circle cx={at(position)[0]} cy={at(position)[1]} r={15} fill="rgba(255,122,61,0.25)" /> : null}
              <Circle cx={at(position)[0]} cy={at(position)[1]} r={segments.length ? 7 : 9} fill={segments.length ? C.accent : C.info} stroke={C.text} strokeWidth={2.5} />
            </G>
          ) : null}
        </Svg>
      ) : null}
      {tiles.length ? (
        <Text style={{ position: 'absolute', right: 6, bottom: 4, color: 'rgba(242,244,247,0.55)', fontSize: 9 }}>{MAP_ATTRIBUTION}</Text>
      ) : null}
    </View>
  );
}

/** 列表用的路線縮圖：只有路線，沒有底圖 */
export function RouteThumb({ track, size = 56 }: { track: LatLon[][]; size?: number }) {
  const view = useMemo(() => fitViewport(track.flat(), size, size, 8), [track, size]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="路線縮圖" style={{ width: size, height: size, borderRadius: 12, backgroundColor: '#151A21', overflow: 'hidden' }}>
      {view ? (
        <Svg width={size} height={size}>
          <Path d={trackPath(view, track)} stroke={C.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      ) : null}
    </View>
  );
}
