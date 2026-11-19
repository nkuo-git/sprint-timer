// 檢查手機和手錶的安裝檔「是同一個 App」：套件名相同、簽章憑證相同、版本號相同。
// Wear OS 只讓套件名與簽章都相同的手機版、手錶版透過配對連線互通（帳號頁看手錶版本、從手機更新手錶）；
// 不一樣的話兩個都裝得起來，但彼此找不到對方，所以在發佈前擋下來。
// 用法：node scripts/check-apk-pair.mjs <手機.apk> <手錶.apk>（需要 Android SDK 的 build-tools）
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 從 `aapt2 dump badging` 的輸出取出套件名與 versionCode */
export function parseBadging(out) {
  const m = /^package: name='([^']+)' versionCode='(\d+)'/m.exec(out);
  return m ? { pkg: m[1], versionCode: Number(m[2]) } : null;
}

/** 從 `apksigner verify --print-certs` 的輸出取出每個簽章憑證的 SHA-256 */
export function parseCerts(out) {
  // 新舊版 apksigner 的開頭不一樣：「Signer #1 certificate …」或「Signer (minSdkVersion=24, maxSdkVersion=32) certificate …」
  const found = [...out.matchAll(/^Signer\b.*\bcertificate SHA-256 digest: ([0-9a-f]{64})\s*$/gm)].map((m) => m[1]);
  return [...new Set(found)].sort();
}

/** 兩個安裝檔不能互通的原因；可以互通回傳空陣列 */
export function pairProblems(phone, watch) {
  const problems = [];
  if (phone.pkg !== watch.pkg) problems.push(`套件名不同：手機 ${phone.pkg}，手錶 ${watch.pkg}`);
  if (phone.versionCode !== watch.versionCode) problems.push(`版本號不同：手機 ${phone.versionCode}，手錶 ${watch.versionCode}`);
  if (!phone.certs.length || phone.certs.join() !== watch.certs.join()) problems.push(`簽章憑證不同：手機 ${phone.certs.join() || '（讀不到）'}，手錶 ${watch.certs.join() || '（讀不到）'}`);
  return problems;
}

function buildTools() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(join(sdk, 'build-tools'))) throw new Error('找不到 Android SDK 的 build-tools（ANDROID_HOME 沒設定）');
  const versions = readdirSync(join(sdk, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return join(sdk, 'build-tools', versions[versions.length - 1]);
}

function inspect(tools, apk) {
  const badging = parseBadging(execFileSync(join(tools, 'aapt2'), ['dump', 'badging', apk], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  if (!badging) throw new Error(`讀不到 ${apk} 的套件名`);
  const signers = execFileSync(join(tools, 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' });
  const certs = parseCerts(signers);
  if (!certs.length) console.error(`讀不到 ${apk} 的簽章憑證，apksigner 的輸出：\n${signers}`);
  return { ...badging, certs };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [phoneApk, watchApk] = process.argv.slice(2);
  if (!phoneApk || !watchApk) {
    console.error('用法：node scripts/check-apk-pair.mjs <手機.apk> <手錶.apk>');
    process.exit(2);
  }
  const tools = buildTools();
  const phone = inspect(tools, phoneApk);
  const watch = inspect(tools, watchApk);
  console.log('手機：', JSON.stringify(phone));
  console.log('手錶：', JSON.stringify(watch));
  const problems = pairProblems(phone, watch);
  if (problems.length) {
    console.error('手機和手錶的安裝檔無法互通：\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('手機和手錶的安裝檔是同一個 App（套件名、簽章、版本號都相同）。');
}
