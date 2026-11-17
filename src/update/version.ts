/** Release 標籤格式：build-N（N = GitHub Actions run number = Android versionCode） */
export function parseBuildTag(tag: string | null | undefined): number | null {
  const m = /^build-(\d+)$/.exec(tag ?? '');
  return m ? Number(m[1]) : null;
}

export interface ReleaseInfo {
  build: number;
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
  return { build, tag: json.tag_name, apkUrl: asset.browser_download_url, sizeBytes: asset.size ?? 0, notes: json.body ?? '' };
}

export function isNewer(release: ReleaseInfo | null, currentBuild: number | null): boolean {
  return !!release && currentBuild !== null && release.build > currentBuild;
}
