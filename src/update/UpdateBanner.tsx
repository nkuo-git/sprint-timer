import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Btn, C, NUM } from '../ui/kit';
import { checkForUpdate, currentBuild, downloadAndInstall } from './updater';
import type { ReleaseInfo } from './version';

/**
 * 設計稿「6 更新提示」：從下方滑出的面板。
 * App 回到首頁時自動檢查，有新版才出現；計時畫面不會檢查，所以計時中不會跳出來。
 */
export function UpdateSheet() {
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    checkForUpdate().then(setRel).catch(() => {}); // 沒網路時安靜略過
  }, []);

  if (!rel || dismissed) return null;

  const update = async () => {
    setError('');
    setProgress(0);
    try {
      await downloadAndInstall(rel, setProgress);
      setLaunched(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setProgress(null);
    }
  };

  const notes = rel.notes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  const downloading = progress !== null;
  const pct = Math.round((progress ?? 0) * 100);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={() => setDismissed(true)}>
      <Pressable accessibilityLabel="關閉" style={{ flex: 1, backgroundColor: 'rgba(6,8,11,0.65)' }} onPress={() => !downloading && setDismissed(true)} />
      <View style={{ backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#3A414D' }} />
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.onAccent, fontSize: 26, fontWeight: '900' }}>↓</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '900' }}>有新版本</Text>
            <Text style={[NUM, { color: C.dim, fontSize: 14 }]}>
              build {currentBuild() ?? '?'} → build {rel.build}
            </Text>
          </View>
        </View>

        {notes.length ? (
          <View style={{ backgroundColor: C.bg, borderRadius: 14, padding: 14, gap: 8 }}>
            <Text style={{ color: C.soft, fontSize: 14, fontWeight: '700' }}>更新內容</Text>
            {notes.map((n, i) => (
              <Text key={i} style={{ color: C.soft, fontSize: 14, lineHeight: 22 }}>
                {n.startsWith('-') || n.startsWith('•') ? n : `• ${n}`}
              </Text>
            ))}
          </View>
        ) : null}

        {downloading ? (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: C.soft, fontSize: 14 }}>下載中…</Text>
              <Text style={[NUM, { color: C.soft, fontSize: 14 }]}>{pct}%</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' }}>
              <View style={{ height: 8, width: `${pct}%`, backgroundColor: C.accent }} />
            </View>
          </View>
        ) : null}

        {error ? <Text style={{ color: C.badText, fontSize: 14 }}>{error}</Text> : null}

        {!downloading ? (
          <View style={{ gap: 10 }}>
            <Btn big title={launched ? '再次開啟安裝' : error ? '重試' : '立即更新'} onPress={update} />
            <Btn kind="plain" title="稍後" onPress={() => setDismissed(true)} style={{ minHeight: 52 }} />
          </View>
        ) : null}
        <Text style={{ color: C.faint, fontSize: 12, textAlign: 'center' }}>
          {launched ? '請在系統安裝畫面按「更新」，完成後重新開啟 App。' : '計時中不會跳出更新，結束這趟後才會提醒。'}
        </Text>
      </View>
    </Modal>
  );
}

/** 舊名稱，保留相容 */
export const UpdateBanner = UpdateSheet;
