/**
 * Release 標籤：build-N（N = Android versionCode，只會變大，用來比較新舊）
 * Release 標題：vX.Y（給人看的版本，例如 v0.4）
 */
export function parseBuildTag(tag: string | null | undefined): number | null {
  const m = /^build-(\d+)$/.exec(tag ?? '');
  return m ? Number(m[1]) : null;
}

export interface ReleaseInfo {
  build: number;
  /** 顯示版本，例如 "0.4"；舊的 Release 沒有時用 "build-N" */
  version: string;
  tag: string;
  apkUrl: string;
  sizeBytes: number;
  notes: string;
}

/** 從 GitHub releases/latest API 回應取出更新資訊；格式不符回傳 null */
export function pickRelease(json: any, assetName = 'sprint-timer.apk'): ReleaseInfo | null {
  const build = parseBuildTag(json?.tag_name);
  const asset = (json?.assets ?? []).find((a: any) => a?.name === assetName);
  if (build === null || !asset?.browser_download_url) return null;
  const v = /^v(\d+\.\d+)$/.exec(json?.name ?? '');
  return { build, version: v ? v[1] : json.tag_name, tag: json.tag_name, apkUrl: asset.browser_download_url, sizeBytes: asset.size ?? 0, notes: json.body ?? '' };
}

export function isNewer(release: ReleaseInfo | null, currentBuild: number | null): boolean {
  return !!release && currentBuild !== null && release.build > currentBuild;
}
