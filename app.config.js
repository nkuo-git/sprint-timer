// 在 app.json 的基礎上動態設定版本號（CI 傳入）：
//  - APP_VERSION：顯示給人看的版本 0.N（scripts/next-version.mjs 算出，每次發佈 +1）
//  - BUILD_NUMBER：Android versionCode = GitHub Actions run number = Release 標籤 build-N，只會變大，App 內更新用它比較新舊
const cloud = require('./cloud.config.json');

module.exports = ({ config }) => {
  const build = Number(process.env.BUILD_NUMBER || 1);
  // Email 登入：登入信裡的連結在 <專案>.firebaseapp.com/__/auth/ 底下。把 App 註冊成這些連結的處理者，
  // 使用者在手機上點連結就會直接開 App（Android App Links；網域那一端由 Firebase 依後台登記的憑證指紋自動提供驗證檔）。
  const loginLinks = cloud.projectId
    ? [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: `${cloud.projectId}.firebaseapp.com`, pathPrefix: '/__/auth/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ]
    : [];
  return {
    ...config,
    version: process.env.APP_VERSION || '0.0',
    ios: { ...config.ios, buildNumber: String(build) },
    android: {
      ...config.android,
      versionCode: build,
      // App 內更新：下載 APK 後叫出系統安裝畫面需要這個權限
      permissions: [...(config.android?.permissions ?? []), 'android.permission.REQUEST_INSTALL_PACKAGES'],
      intentFilters: [...(config.android?.intentFilters ?? []), ...loginLinks],
    },
  };
};
