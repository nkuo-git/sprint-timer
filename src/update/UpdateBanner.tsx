import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Btn, C, s } from '../ui/kit';
import { checkForUpdate, currentBuild, downloadAndInstall } from './updater';
import type { ReleaseInfo } from './version';

/**
 * 暫時的最小更新提示（尚未經過 Claude Design 設計，之後依設計稿替換）。
 * App 啟動時自動檢查，有新版才出現。
 */
export function UpdateBanner() {
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    checkForUpdate().then(setRel).catch(() => {}); // 沒網路時安靜略過
  }, []);

  if (!rel) return null;
  const update = async () => {
    setError('');
    setProgress(0);
    try {
      await downloadAndInstall(rel, setProgress);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <View style={[s.card, { borderWidth: 1, borderColor: C.accent }]}>
      <Text style={s.label}>
        有新版本 build-{rel.build}（目前 build-{currentBuild() ?? '?'}）
      </Text>
      <Btn
        title={progress === null ? '下載並更新' : `下載中 ${Math.round(progress * 100)}%`}
        onPress={update}
        disabled={progress !== null}
      />
      {error ? <Text style={[s.small, { color: C.bad }]}>{error}</Text> : null}
    </View>
  );
}
