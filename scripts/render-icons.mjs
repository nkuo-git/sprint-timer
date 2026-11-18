// 把 assets/logo/*.svg 轉成 App 用的 PNG 圖示。改了 logo 之後執行：node scripts/render-icons.mjs
// 需要 Playwright（npx playwright install chromium），只在改圖示時用得到，所以沒有列進 package.json。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// [來源 SVG, 輸出 PNG, 邊長 px, 是否透明底]
const targets = [
  ['icon.svg', 'icon.png', 1024, false],
  ['icon.svg', 'favicon.png', 48, false],
  ['android-foreground.svg', 'android-icon-foreground.png', 1024, true],
  ['android-monochrome.svg', 'android-icon-monochrome.png', 432, true],
  ['splash.svg', 'splash-icon.png', 1024, true],
];

const browser = await chromium.launch();
for (const [src, out, size, transparent] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = readFileSync(join(assets, 'logo', src), 'utf8').replace(/<!--[\s\S]*?-->/, '');
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  writeFileSync(join(assets, out), await page.screenshot({ omitBackground: transparent }));
  await page.close();
  console.log(`${out} ${size}x${size}`);
}
// Android 自適應圖示背景：純色
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent('<style>html,body{margin:0;background:#0E1116}</style>');
  writeFileSync(join(assets, 'android-icon-background.png'), await page.screenshot());
  console.log('android-icon-background.png 512x512');
}
await browser.close();
