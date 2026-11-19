import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Banner, C, NUM, s } from '../ui/kit';
import { UpdateSheet } from './UpdateBanner';
import { useVersions } from './useVersions';
import type { VersionRow } from './versionView';

/**
 * 設計稿「24 帳號：App 版本」「25 帳號：更新手錶中」：這支手機和手錶各自的目前版本與最新版本，
 * 手機有新版按「更新」開原本的更新面板（設計稿 6），手錶有新版按「更新手錶」由手機傳過去安裝。
 */
export function VersionSection() {
  const { view, latest, checking, refresh, updateWatch } = useVersions();
  const [phoneSheet, setPhoneSheet] = useState(false);
  const pct = Math.round((view.progress?.fraction ?? 0) * 100);

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { justifyContent: 'space-between', minHeight: 44 }]}>
        <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>App 版本</Text>
        {view.busy ? null : (
          <Pressable accessibilityRole="button" onPress={refresh} disabled={checking} hitSlop={8} style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: C.infoText, fontSize: 14, fontWeight: '500' }}>{checking ? '檢查中…' : '重新檢查'}</Text>
          </Pressable>
        )}
      </View>

      <View style={{ backgroundColor: C.card, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 16 }}>
        <Row icon={<PhoneIcon />} label="這支手機" row={view.phone} action={view.phone.canUpdate ? '更新' : null} onAction={() => setPhoneSheet(true)} />
        {view.watch ? (
          <>
            <View style={{ height: 1, backgroundColor: C.raised }} />
            <Row icon={<WatchIcon />} label="手錶" row={view.watch} action={view.watchAction} onAction={updateWatch} />
            {view.progress ? (
              <View style={{ gap: 8, paddingBottom: 16 }} accessibilityRole="progressbar" accessibilityLabel={view.progress.label}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.soft, fontSize: 14 }}>{view.progress.label}</Text>
                  {view.progress.showPercent ? <Text style={[NUM, { color: C.soft, fontSize: 14 }]}>{pct}%</Text> : null}
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' }}>
                  <View style={{ height: 8, width: `${pct}%`, backgroundColor: C.accent }} />
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {view.hint ? <Text style={{ color: C.dim, fontSize: 13, lineHeight: 21 }}>{view.hint}</Text> : null}
      {view.banner ? <Banner tone={view.banner.tone} text={view.banner.text} /> : null}

      {phoneSheet && latest?.phone ? <UpdateSheet release={latest.phone} onClose={() => setPhoneSheet(false)} /> : null}
    </View>
  );
}

function Row({ icon, label, row, action, onAction }: { icon: React.ReactNode; label: string; row: VersionRow; action: string | null; onAction(): void }) {
  const noteColor = row.tone === 'ok' ? C.infoText : row.tone === 'new' ? C.warn : C.dim;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 80 }}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: C.dim, fontSize: 13 }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Text style={[NUM, { color: row.isVersion ? C.text : C.soft, fontSize: row.isVersion ? 24 : 18, fontWeight: '700' }]}>{row.value}</Text>
          {row.note ? <Text style={[NUM, { color: noteColor, fontSize: 14 }]}>{row.note}</Text> : null}
        </View>
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: 18, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.75 }]}
        >
          <Text style={{ color: C.onAccent, fontSize: 16, fontWeight: '700' }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 手機圖示（設計稿是線條圖示；這裡用邊框畫） */
function PhoneIcon() {
  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: 14, height: 24, borderRadius: 4, borderWidth: 2, borderColor: C.soft, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 }}>
        <View style={{ width: 4, height: 2, borderRadius: 1, backgroundColor: C.soft }} />
      </View>
    </View>
  );
}

/** 手錶圖示：圓形錶面加上下錶帶 */
function WatchIcon() {
  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: 8, height: 5, borderTopLeftRadius: 2, borderTopRightRadius: 2, borderWidth: 2, borderBottomWidth: 0, borderColor: C.soft }} />
      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.soft }} />
      <View style={{ width: 8, height: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, borderWidth: 2, borderTopWidth: 0, borderColor: C.soft }} />
    </View>
  );
}
