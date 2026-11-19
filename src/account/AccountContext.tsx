import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { CLOUD } from '../cloud/config';
import { fileStorage } from '../storage/fileStorage';
import { AccountService, type AccountSnapshot } from './service';

const Ctx = createContext<AccountService | null>(null);

function createService(): AccountService {
  const records = fileStorage('records.json');
  return new AccountService({
    config: CLOUD,
    fetch: (url, init) => fetch(url, init),
    sessionStorage: fileStorage('session.json'),
    records: { load: records.load, save: (v) => records.save(v) },
  });
}

/** 包在 App 最外層：啟動時讀回登入狀態與紀錄，回到 App 時自動同步 */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [service] = useState(createService);
  useEffect(() => {
    void service.start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void service.refresh();
    });
    return () => sub.remove();
  }, [service]);
  return <Ctx.Provider value={service}>{children}</Ctx.Provider>;
}

/** 帳號與紀錄的狀態（account）和操作（service）。紀錄有變動時畫面會重畫。 */
export function useAccount(): { account: AccountSnapshot; service: AccountService } {
  const service = useContext(Ctx);
  if (!service) throw new Error('useAccount 必須在 AccountProvider 裡使用');
  const account = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  return { account, service };
}
