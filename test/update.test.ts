import { describe, expect, it } from 'vitest';
import { isNewer, parseBuildTag, pickRelease } from '../src/update/version';

describe('App 內更新版本比對', () => {
  it('解析 build-N 標籤', () => {
    expect(parseBuildTag('build-12')).toBe(12);
    expect(parseBuildTag('v1.0')).toBeNull();
    expect(parseBuildTag(undefined)).toBeNull();
  });
  it('從 releases/latest 回應取出 APK', () => {
    const rel = pickRelease({
      tag_name: 'build-5',
      body: 'x',
      assets: [{ name: 'other.zip' }, { name: 'sprint-timer.apk', size: 10, browser_download_url: 'https://e/x.apk' }],
    });
    expect(rel).toMatchObject({ build: 5, apkUrl: 'https://e/x.apk', sizeBytes: 10 });
    expect(pickRelease({ tag_name: 'build-5', assets: [] })).toBeNull();
  });
  it('顯示版本取自 Release 標題 vX.Y，舊格式退回標籤', () => {
    const asset = [{ name: 'sprint-timer.apk', browser_download_url: 'u' }];
    expect(pickRelease({ tag_name: 'build-9', name: 'v0.4', assets: asset })?.version).toBe('0.4');
    expect(pickRelease({ tag_name: 'build-7', name: 'Android build 7', assets: asset })?.version).toBe('build-7');
  });
  it('只有比較新的才更新；版本未知不更新', () => {
    const rel = pickRelease({ tag_name: 'build-5', assets: [{ name: 'sprint-timer.apk', browser_download_url: 'u' }] });
    expect(isNewer(rel, 4)).toBe(true);
    expect(isNewer(rel, 5)).toBe(false);
    expect(isNewer(rel, null)).toBe(false);
  });
});

import { nextVersion } from '../scripts/next-version.mjs';

describe('版本號計算', () => {
  it('主版 0 第一版是 0.4，之後每次 +1', () => {
    expect(nextVersion([{ name: 'Android build 7' }], 0)).toBe('0.4');
    expect(nextVersion([{ name: 'v0.4' }, { name: 'Android build 7' }], 0)).toBe('0.5');
    expect(nextVersion([{ name: 'v0.9' }, { name: 'v0.10' }], 0)).toBe('0.11');
  });
  it('換主版後小數點後從 0 開始', () => {
    expect(nextVersion([{ name: 'v0.12' }], 1)).toBe('1.0');
    expect(nextVersion([{ name: 'v1.0' }, { name: 'v0.12' }], 1)).toBe('1.1');
  });
});
