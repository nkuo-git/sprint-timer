import { CloudClient, type CloudUser, type FetchLike, type SessionStorage } from '../cloud/client';
import { cloudConfigured, type CloudConfig } from '../cloud/config';
import { deleteAccount, fetchMyNickname, nicknameAvailable, saveNickname, searchPeople, untagMe, type Person } from '../cloud/profile';
import { RecordStore, type Persistence, type RaceInput } from '../records/store';
import { RecordSync, type SyncStatus } from '../records/sync';

export interface AccountSnapshot {
  /** 讀完手機上的登入狀態與紀錄了 */
  ready: boolean;
  /** 有設定雲端專案（沒有的話不顯示登入相關功能） */
  cloudEnabled: boolean;
  user: CloudUser | null;
  nickname: string | null;
  /** 已登入但還沒取暱稱（要先到取暱稱畫面） */
  needsNickname: boolean;
  sync: SyncStatus;
  /** 等待上傳的比賽數 */
  pending: number;
  /** 手機上的紀錄每變動一次就 +1（列表畫面據此重畫） */
  recordsRev: number;
}

const SYNC_DELAY_MS = 1500;

/**
 * 帳號、紀錄、同步的總管（不含 React）。畫面透過 useAccount() 取得 snapshot 並呼叫這裡的方法。
 * 成績一律先存手機（store），有登入而且有網路時再同步到雲端。
 */
export class AccountService {
  readonly store: RecordStore;
  readonly cloud: CloudClient | null;
  private readonly sync: RecordSync | null;
  private listeners = new Set<() => void>();
  private ready = false;
  private nicknameKnown = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recordsRev = 0;
  private snap: AccountSnapshot;

  constructor(deps: { config: CloudConfig; fetch: FetchLike; sessionStorage: SessionStorage; records: Persistence; now?: () => number }) {
    this.store = new RecordStore(deps.records);
    this.cloud = cloudConfigured(deps.config) ? new CloudClient(deps.config, deps.fetch, deps.sessionStorage, deps.now) : null;
    this.sync = this.cloud ? new RecordSync(this.cloud, this.store, deps.now) : null;
    this.snap = this.compute();
    this.store.subscribe(() => {
      this.recordsRev++;
      this.emit();
    });
    this.sync?.subscribe(() => this.emit());
    this.cloud?.onChange(() => this.emit());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AccountSnapshot => this.snap;

  private get uid(): string | null {
    return this.cloud?.user?.id ?? null;
  }

  private compute(): AccountSnapshot {
    const user = this.cloud?.user ?? null;
    const me = this.store.data.me;
    const nickname = user && me?.id === user.id ? me.nickname : null;
    return {
      ready: this.ready,
      cloudEnabled: !!this.cloud,
      user,
      nickname,
      needsNickname: !!user && this.nicknameKnown && nickname === null,
      sync: this.sync?.status ?? { state: 'idle', lastOk: null },
      pending: this.store.pendingCount(user?.id ?? null),
      recordsRev: this.recordsRev,
    };
  }

  private emit() {
    const next = this.compute();
    const prev = this.snap;
    const same =
      prev.ready === next.ready &&
      prev.user?.id === next.user?.id &&
      prev.nickname === next.nickname &&
      prev.needsNickname === next.needsNickname &&
      prev.sync === next.sync &&
      prev.pending === next.pending &&
      prev.recordsRev === next.recordsRev;
    if (same) return;
    this.snap = next;
    for (const fn of this.listeners) fn();
  }

  /** App 啟動時呼叫一次 */
  async start(): Promise<void> {
    await this.store.load();
    await this.cloud?.init();
    const uid = this.uid;
    if (uid && this.store.data.me?.id === uid) this.nicknameKnown = true;
    this.ready = true;
    this.emit();
    if (uid) void this.refresh();
  }

  /** 回到 App 或手動重新整理：更新暱稱並同步 */
  async refresh(): Promise<void> {
    if (!this.cloud || !this.uid) return;
    await this.loadNickname().catch(() => undefined);
    await this.sync!.sync();
  }

  private async loadNickname() {
    const uid = this.uid;
    if (!this.cloud || !uid) return;
    const nickname = await fetchMyNickname(this.cloud);
    if (this.uid !== uid) return;
    this.store.data.me = { id: uid, nickname };
    this.nicknameKnown = true;
    await this.store.commit();
  }

  requestCode(email: string): Promise<void> {
    return this.need().requestCode(email);
  }

  /** 輸入驗證碼登入。成功後會知道有沒有暱稱（needsNickname），並開始同步。 */
  async verifyCode(email: string, code: string): Promise<void> {
    await this.need().verifyCode(email, code);
    this.nicknameKnown = false;
    // 剛登入就斷線的話，暱稱等下次 refresh() 再補
    await this.loadNickname().catch(() => undefined);
    void this.sync!.sync();
  }

  /** 暱稱有沒有被別人用掉 */
  nicknameAvailable(nickname: string): Promise<boolean> {
    return nicknameAvailable(this.need(), nickname);
  }

  /** 把「別人標記給我」的新成績記為看過 */
  markTaggedSeen(): Promise<void> {
    return this.store.markTaggedSeen();
  }

  async setNickname(nickname: string): Promise<'ok' | 'taken'> {
    const cloud = this.need();
    const res = await saveNickname(cloud, nickname);
    if (res === 'ok' && this.uid) {
      this.store.data.me = { id: this.uid, nickname: nickname.trim() };
      this.nicknameKnown = true;
      await this.store.commit();
    }
    return res;
  }

  async signOut(): Promise<void> {
    const uid = this.uid;
    if (!this.cloud || !uid) return;
    // 登出前盡量把還沒上傳的傳上去；沒網路就留在手機
    await this.sync!.sync();
    await this.cloud.signOut();
    this.nicknameKnown = false;
    await this.store.clearAccountData(uid);
  }

  async deleteAccount(): Promise<void> {
    const uid = this.uid;
    if (!this.cloud || !uid) return;
    await deleteAccount(this.cloud);
    this.nicknameKnown = false;
    // 雲端的都刪了，手機上這個帳號的紀錄也一起清掉
    this.store.data.races = this.store.data.races.filter((r) => r.owner !== uid);
    await this.store.clearAccountData(uid);
  }

  searchPeople(query: string): Promise<Person[]> {
    return searchPeople(this.need(), query);
  }

  /** 把別人標記給我的成績從我的紀錄拿掉 */
  async untag(resultId: string): Promise<void> {
    await untagMe(this.need(), resultId);
    await this.sync!.sync();
  }

  /** 成績畫面每次變動都呼叫：先存手機，稍後自動上傳 */
  async saveRace(race: RaceInput): Promise<void> {
    await this.store.saveRace(race, this.uid);
    this.scheduleSync();
  }

  async deleteRace(id: string): Promise<void> {
    await this.store.deleteRace(id);
    this.scheduleSync();
  }

  private scheduleSync() {
    if (!this.sync || !this.uid) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync!.sync();
    }, SYNC_DELAY_MS);
  }

  /** 立刻同步（測試與「重新整理」用），等到同步結束 */
  async syncNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.sync?.sync();
  }

  private need(): CloudClient {
    if (!this.cloud) throw new Error('這個版本還沒設定雲端');
    return this.cloud;
  }
}

