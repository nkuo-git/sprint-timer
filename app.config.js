// 在 app.json 的基礎上動態設定版本號：CI 會傳入 BUILD_NUMBER（= GitHub Actions run number = Release 的 build-N）。
// App 內更新就是比對這個數字和 GitHub 最新 Release 的 N。
module.exports = ({ config }) => {
  const build = Number(process.env.BUILD_NUMBER || 1);
  return {
    ...config,
    version: `0.1.${build}`,
    ios: { ...config.ios, buildNumber: String(build) },
    android: {
      ...config.android,
      versionCode: build,
      // App 內更新：下載 APK 後叫出系統安裝畫面需要這個權限
      permissions: [...(config.android?.permissions ?? []), 'android.permission.REQUEST_INSTALL_PACKAGES'],
    },
  };
};
