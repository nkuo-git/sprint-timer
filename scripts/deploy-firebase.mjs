// 把 firestore.rules（資料庫權限規則）和 firebase/hosting（登入連結的網頁）發佈到 Firebase 專案（cloud.config.json 的 projectId）。
// 用法：GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/deploy-firebase.mjs [rules] [hosting]
//       不指定就兩個都發佈。需要對該專案有擁有者權限的 Google 帳號。
// 規則也可以不用這支程式：把 firestore.rules 的內容貼到 Firebase 後台 → Firestore Database → 規則 → 發佈。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const { projectId } = JSON.parse(readFileSync(join(root, 'cloud.config.json'), 'utf8'));
const token = process.env.GOOGLE_ACCESS_TOKEN;
if (!projectId) throw new Error('cloud.config.json 還沒填 projectId');
if (!token) throw new Error('請設定環境變數 GOOGLE_ACCESS_TOKEN');
const what = process.argv.slice(2);
const want = (name) => what.length === 0 || what.includes(name);

const headers = { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': projectId, 'Content-Type': 'application/json' };

async function call(method, url, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${method} ${url} → ${res.status} ${json?.error?.message ?? ''}`), { status: res.status });
  return json;
}

async function deployRules() {
  const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;
  const content = readFileSync(join(root, 'firestore.rules'), 'utf8');
  const ruleset = await call('POST', `${base}/rulesets`, { source: { files: [{ name: 'firestore.rules', content }] } });
  const release = { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: ruleset.name };
  try {
    await call('PATCH', `${base}/releases/cloud.firestore`, { release });
  } catch (e) {
    if (e.status !== 404) throw e;
    await call('POST', `${base}/releases`, release);
  }
  console.log(`規則已發佈：${ruleset.name}`);
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

async function deployHosting() {
  const dir = join(root, 'firebase', 'hosting');
  const base = 'https://firebasehosting.googleapis.com/v1beta1';
  const site = `sites/${projectId}`;
  // 每個檔案：壓縮後算雜湊，Hosting 只要求上傳它還沒有的內容
  const files = {};
  const blobs = new Map();
  for (const path of listFiles(dir)) {
    const gz = gzipSync(readFileSync(path), { level: 9 });
    const hash = createHash('sha256').update(gz).digest('hex');
    files[`/${relative(dir, path).split(sep).join('/')}`] = hash;
    blobs.set(hash, gz);
  }
  const version = await call('POST', `${base}/${site}/versions`, {
    config: {
      headers: [
        { glob: '**', headers: { 'Cache-Control': 'no-cache' } },
        { glob: '/.well-known/assetlinks.json', headers: { 'Content-Type': 'application/json' } },
      ],
    },
  });
  const populated = await call('POST', `${base}/${version.name}:populateFiles`, { files });
  for (const hash of populated.uploadRequiredHashes ?? []) {
    const res = await fetch(`${populated.uploadUrl}/${hash}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': projectId, 'Content-Type': 'application/octet-stream' },
      body: blobs.get(hash),
    });
    if (!res.ok) throw new Error(`上傳失敗 ${res.status} ${await res.text()}`);
  }
  await call('PATCH', `${base}/${version.name}?update_mask=status`, { status: 'FINALIZED' });
  await call('POST', `${base}/${site}/releases?versionName=${encodeURIComponent(version.name)}`, { message: 'scripts/deploy-firebase.mjs' });
  console.log(`網頁已發佈：https://${projectId}.firebaseapp.com/（${Object.keys(files).join('、')}）`);
}

if (want('rules')) await deployRules();
if (want('hosting')) await deployHosting();
