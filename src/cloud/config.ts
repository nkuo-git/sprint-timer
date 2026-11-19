import config from '../../cloud.config.json';

/**
 * 雲端（Firebase）專案設定，放在專案根目錄的 cloud.config.json。
 * 兩個值都是公開的識別碼：權限由 Firestore 的安全規則（firestore.rules）控管，所以可以直接放在 App 裡。
 * 還沒設定（空字串）時，App 會隱藏登入與同步功能，其餘照常運作。
 * 設定步驟見 firebase/README.md。
 */
export interface CloudConfig {
  /** Firebase 專案 ID，例如 sprint-timer-1a2b3 */
  projectId: string;
  /** 網頁 API 金鑰（firebaseConfig.apiKey） */
  apiKey: string;
  /** 測試用：改連本機的 Firebase 模擬器，例如 { auth: 'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8080' } */
  emulator?: { auth: string; firestore: string };
}

export const CLOUD: CloudConfig = { projectId: config.projectId, apiKey: config.apiKey };

export function cloudConfigured(cfg: CloudConfig = CLOUD): boolean {
  return /^[a-z0-9][a-z0-9-]{3,}$/.test(cfg.projectId) && cfg.apiKey.length > 0;
}

/** 登入信裡的連結所在的網域；App 註冊成這個網域的連結處理者（app.config.js） */
export function linkHost(cfg: CloudConfig): string {
  return `${cfg.projectId}.firebaseapp.com`;
}

export interface Endpoints {
  /** Identity Toolkit（登入） */
  auth: string;
  /** 換新憑證 */
  token: string;
  /** Firestore REST 根網址 */
  firestore: string;
  /** 文件名稱的前綴：projects/x/databases/(default)/documents */
  docs: string;
}

export function endpoints(cfg: CloudConfig): Endpoints {
  const docs = `projects/${cfg.projectId}/databases/(default)/documents`;
  if (cfg.emulator) {
    return {
      auth: `${cfg.emulator.auth}/identitytoolkit.googleapis.com/v1`,
      token: `${cfg.emulator.auth}/securetoken.googleapis.com/v1/token`,
      firestore: `${cfg.emulator.firestore}/v1`,
      docs,
    };
  }
  return {
    auth: 'https://identitytoolkit.googleapis.com/v1',
    token: 'https://securetoken.googleapis.com/v1/token',
    firestore: 'https://firestore.googleapis.com/v1',
    docs,
  };
}
