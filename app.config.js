// 在 app.json 的基礎上動態設定版本號（CI 傳入）：
//  - APP_VERSION：顯示給人看的版本 0.N（scripts/next-version.mjs 算出，每次發佈 +1）
//  - BUILD_NUMBER：Android versionCode = GitHub Actions run number = Release 標籤 build-N，只會變大，App 內更新用它比較新舊
module.exports = ({ config }) => {
  const build = Number(process.env.BUILD_NUMBER || 1);
  return {
    ...config,
    version: process.env.APP_VERSION || '0.0',
    ios: { ...config.ios, buildNumber: String(build) },
    android: {
      ...config.android,
      versionCode: build,
      // App 內更新：下載 APK 後叫出系統安裝畫面需要這個權限
      permissions: [...(config.android?.permissions ?? []), 'android.permission.REQUEST_INSTALL_PACKAGES'],
    },
  };
};
