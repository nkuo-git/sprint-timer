// 計算下一個顯示版本 MAJOR.MINOR。
// 讀 stdin 的 GitHub releases JSON 陣列，找出標題為 vMAJOR.N 的最大 N，下一版 = N + 1。
// 還沒有任何 vMAJOR.x 時：主版 0 從 0.4 開始（Nick 指定），其他主版從 .0 開始。
import { readFileSync } from 'node:fs';

export function nextVersion(releases, major) {
  const re = new RegExp(`^v${major}\\.(\\d+)$`);
  const minors = releases.map((r) => re.exec(r?.name ?? '')).filter(Boolean).map((m) => Number(m[1]));
  const minor = minors.length ? Math.max(...minors) + 1 : major === 0 ? 4 : 0;
  return `${major}.${minor}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { major } = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8'));
  const releases = JSON.parse(readFileSync(0, 'utf8') || '[]');
  process.stdout.write(nextVersion(releases, major));
}
