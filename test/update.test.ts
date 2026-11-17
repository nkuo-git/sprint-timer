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
  it('只有比較新的才更新；版本未知不更新', () => {
    const rel = pickRelease({ tag_name: 'build-5', assets: [{ name: 'sprint-timer.apk', browser_download_url: 'u' }] });
    expect(isNewer(rel, 4)).toBe(true);
    expect(isNewer(rel, 5)).toBe(false);
    expect(isNewer(rel, null)).toBe(false);
  });
});
