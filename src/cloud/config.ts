import config from '../../cloud.config.json';

/**
 * 雲端（Supabase）專案設定，放在專案根目錄的 cloud.config.json。
 * 兩個值都是公開的：權限由資料庫的 RLS 規則控管，所以可以直接放在 App 裡。
 * 還沒設定（空字串）時，App 會隱藏登入與同步功能，其餘照常運作。
 * 設定步驟見 supabase/README.md。
 */
export interface CloudConfig {
  /** 例如 https://abcdefgh.supabase.co */
  url: string;
  /** anon / publishable key（不是 service_role / secret key） */
  key: string;
}

export const CLOUD: CloudConfig = { url: config.url, key: config.key };

export function cloudConfigured(cfg: CloudConfig = CLOUD): boolean {
  return /^https:\/\/.+/.test(cfg.url) && cfg.key.length > 0;
}
