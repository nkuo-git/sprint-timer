import { endpoints, linkHost, type CloudConfig, type Endpoints } from './config';
import { decodeFields, encodeFields, encodeValue, type Fields, type Plain } from './values';

/**
 * 很薄的 Firebase 用戶端：只用 fetch 呼叫 Auth（Email 連結登入）和 Firestore 的 REST API。
 * 不依賴 Firebase SDK，App 不用多裝原生套件，也方便在 Node 測試。
 */

export interface CloudUser {
  id: string;
  email: string;
}

export interface Session {
  idToken: string;
  refreshToken: string;
  /** idToken 到期時間（epoch 秒） */
  expiresAt: number;
  /** 這次是什麼時候用登入信登入的（epoch 秒）。刪除帳號要求最近登入過。 */
  signedInAt: number;
  user: CloudUser;
}

/** 存登入狀態的地方（手機上是一個檔案） */
export interface SessionStorage {
  load(): Promise<string | null>;
  save(value: string | null): Promise<void>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type CloudErrorKind = 'network' | 'auth' | 'rate-limit' | 'conflict' | 'invalid' | 'server';

export class CloudError extends Error {
  constructor(
    readonly kind: CloudErrorKind,
    message: string,
    readonly status = 0,
    /** Firebase 的錯誤代碼，例如 INVALID_OOB_CODE、PERMISSION_DENIED */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

export function isOffline(e: unknown): boolean {
  return e instanceof CloudError && e.kind === 'network';
}

const REFRESH_MARGIN_S = 60;
/** Firebase 規定刪除帳號等敏感操作要在登入後幾分鐘內進行 */
export const RECENT_LOGIN_S = 240;
const QUERY_PAGE = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length <= 254 && EMAIL_RE.test(e);
}

/**
 * 從登入信的連結取出一次性登入碼（oobCode）。
 * 連結可能被包了好幾層（外層網址把真正的連結放在參數裡），所以解碼幾次都找找看。
 */
export function extractLoginCode(link: string): string | null {
  let text = link.trim();
  for (let i = 0; i < 4; i++) {
    const m = /[?&#]oobCode=([A-Za-z0-9_-]+)/.exec(text);
    if (m) return m[1];
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      break;
    }
    if (decoded === text) break;
    text = decoded;
  }
  return null;
}

/** 這個網址是不是登入信的連結 */
export function isLoginLink(link: string | null | undefined): link is string {
  return !!link && extractLoginCode(link) !== null;
}

export interface Doc {
  /** 文件 id（路徑最後一段） */
  id: string;
  data: Fields;
}

/** 查詢條件：[欄位, 比較方式, 值] */
export type Filter = [field: string, op: '==' | 'array-contains', value: Plain];

/** 一筆寫入。exists 是前提條件：true＝文件必須已存在，false＝必須還不存在。 */
export type Write =
  | { set: string; data: Fields; exists?: boolean }
  /** 只改 data 裡列出的欄位，其他欄位不動 */
  | { patch: string; data: Fields; exists?: boolean }
  | { delete: string; exists?: boolean };

interface Saved {
  session: Session | null;
  /** 已寄出登入信、還沒點連結的 Email */
  pending: { email: string; at: number } | null;
}

export class CloudClient {
  private session: Session | null = null;
  private pending: Saved['pending'] = null;
  private listeners = new Set<(s: Session | null) => void>();
  private refreshing: Promise<Session | null> | null = null;
  private loaded = false;
  private readonly ep: Endpoints;

  constructor(
    private readonly cfg: CloudConfig,
    private readonly fetchImpl: FetchLike,
    private readonly storage: SessionStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.ep = endpoints(cfg);
  }

  get user(): CloudUser | null {
    return this.session?.user ?? null;
  }

  /** 登入信已寄出、等使用者點連結的 Email */
  get pendingEmail(): string | null {
    return this.pending?.email ?? null;
  }

  /** 這次登入到現在不超過幾分鐘（刪除帳號需要） */
  get recentlySignedIn(): boolean {
    return !!this.session && this.now() / 1000 - this.session.signedInAt <= RECENT_LOGIN_S;
  }

  /** 登入狀態改變時通知（登入、登出、憑證失效、寄出登入信） */
  onChange(fn: (s: Session | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** App 啟動時呼叫一次：讀回上次的登入狀態（不需要網路） */
  async init(): Promise<CloudUser | null> {
    if (this.loaded) return this.user;
    this.loaded = true;
    try {
      const raw = await this.storage.load();
      const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
      const s = saved?.session;
      if (s && s.idToken && s.refreshToken && s.user?.id) this.session = { ...s, signedInAt: s.signedInAt ?? 0 };
      if (saved?.pending?.email) this.pending = saved.pending;
    } catch {
      this.session = null;
    }
    return this.user;
  }

  /** 寄登入信（裡面有一個登入連結）。第一次登入的 Email 會自動建立帳號。 */
  async requestLink(email: string): Promise<void> {
    const e = normalizeEmail(email);
    if (!isValidEmail(e)) throw new CloudError('invalid', 'Email 格式不對');
    await this.authCall('accounts:sendOobCode', {
      requestType: 'EMAIL_SIGNIN',
      email: e,
      continueUrl: `https://${linkHost(this.cfg)}/`,
      canHandleCodeInApp: true,
    });
    this.pending = { email: e, at: Math.floor(this.now() / 1000) };
    await this.persist();
    this.notify();
  }

  /** 放棄等待中的登入（回上一步改 Email） */
  async cancelPending(): Promise<void> {
    if (!this.pending) return;
    this.pending = null;
    await this.persist();
    this.notify();
  }

  /**
   * 用登入信裡的連結登入。email 沒給就用剛剛寄信的那個 Email
   * （Firebase 要求連結和 Email 要對得上，所以要在同一支手機上點連結）。
   */
  async signInWithLink(link: string, email?: string): Promise<CloudUser> {
    const code = extractLoginCode(link);
    if (!code) throw new CloudError('invalid', '這不是登入信裡的連結');
    const e = normalizeEmail(email ?? this.pending?.email ?? '');
    if (!isValidEmail(e)) throw new CloudError('invalid', '請先輸入 Email 寄出登入信，再點信裡的連結');
    const res = await this.authCall('accounts:signInWithEmailLink', { oobCode: code, email: e });
    if (!res || typeof res.idToken !== 'string' || typeof res.refreshToken !== 'string' || !res.localId) {
      throw new CloudError('server', '登入回應格式不對');
    }
    const nowS = Math.floor(this.now() / 1000);
    this.pending = null;
    await this.setSession({
      idToken: res.idToken,
      refreshToken: res.refreshToken,
      expiresAt: nowS + (Number(res.expiresIn) || 3600),
      signedInAt: nowS,
      user: { id: res.localId, email: normalizeEmail(res.email ?? e) },
    });
    return this.session!.user;
  }

  /** 登出（只清掉這支手機的登入狀態；沒網路也能登出） */
  async signOut(): Promise<void> {
    if (!this.session && !this.pending) return;
    this.pending = null;
    await this.setSession(null);
  }

  /** 刪除登入帳號本身（資料要先另外刪掉）。Firebase 要求最近登入過。 */
  async deleteUser(): Promise<void> {
    const idToken = await this.token();
    await this.authCall('accounts:delete', { idToken });
    await this.setSession(null);
  }

  // ───────────── Firestore ─────────────

  /** 讀一份文件，例如 getDoc('users/abc')。不存在回傳 null。 */
  async getDoc(path: string): Promise<Doc | null> {
    const url = `${this.ep.firestore}/${this.ep.docs}/${path.split('/').map(encodeURIComponent).join('/')}`;
    try {
      return toDoc(await this.call('GET', url));
    } catch (e) {
      if (e instanceof CloudError && e.status === 404) return null;
      throw e;
    }
  }

  /** 一次讀多份文件；不存在的不會出現在結果裡 */
  async getDocs(paths: string[]): Promise<Doc[]> {
    const out: Doc[] = [];
    for (let i = 0; i < paths.length; i += 100) {
      const documents = paths.slice(i, i + 100).map((p) => `${this.ep.docs}/${p}`);
      const rows = await this.call('POST', `${this.ep.firestore}/${this.ep.docs}:batchGet`, { documents });
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.error) throw toError(Number(row.error.code) || 500, row);
        const doc = row?.found ? toDoc(row.found) : null;
        if (doc) out.push(doc);
      }
    }
    return out;
  }

  /** 查詢一個集合。條件之間是「而且」。max 沒給就全部抓回來（自動分頁）。 */
  async query(collection: string, filters: Filter[], max = Infinity): Promise<Doc[]> {
    const conds = filters.map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op: op === '==' ? 'EQUAL' : 'ARRAY_CONTAINS', value: encodeValue(value) },
    }));
    const where = conds.length === 1 ? conds[0] : { compositeFilter: { op: 'AND', filters: conds } };
    const out: Doc[] = [];
    let after: string | null = null;
    while (out.length < max) {
      const limit = Math.min(QUERY_PAGE, max - out.length);
      const structuredQuery: any = {
        from: [{ collectionId: collection }],
        where,
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit,
      };
      if (after) structuredQuery.startAt = { values: [{ referenceValue: after }], before: false };
      const rows = await this.call('POST', `${this.ep.firestore}/${this.ep.docs}:runQuery`, { structuredQuery });
      let got = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.error) throw toError(Number(row.error.code) || 500, row);
        if (!row?.document) continue;
        got++;
        after = row.document.name;
        const doc = toDoc(row.document);
        if (doc) out.push(doc);
      }
      if (got < limit) break;
    }
    return out;
  }

  /** 一次送出多筆寫入：全部成功或全部不變（最多 500 筆） */
  async commit(writes: Write[]): Promise<void> {
    if (writes.length === 0) return;
    const name = (path: string) => `${this.ep.docs}/${path}`;
    const body = {
      writes: writes.map((w) => {
        const pre = w.exists === undefined ? {} : { currentDocument: { exists: w.exists } };
        if ('delete' in w) return { delete: name(w.delete), ...pre };
        if ('patch' in w) return { update: { name: name(w.patch), fields: encodeFields(w.data) }, updateMask: { fieldPaths: Object.keys(w.data) }, ...pre };
        return { update: { name: name(w.set), fields: encodeFields(w.data) }, ...pre };
      }),
    };
    await this.call('POST', `${this.ep.firestore}/${this.ep.docs}:commit`, body);
  }

  // ───────────── 內部 ─────────────

  private notify() {
    for (const fn of this.listeners) fn(this.session);
  }

  private async persist() {
    try {
      const saved: Saved = { session: this.session, pending: this.pending };
      await this.storage.save(saved.session || saved.pending ? JSON.stringify(saved) : null);
    } catch {
      // 存不進去只影響下次開 App 要重新登入
    }
  }

  private async setSession(s: Session | null) {
    this.session = s;
    await this.persist();
    this.notify();
  }

  /** 取得可用的 idToken；快到期就先換新的。同時只會有一個換新請求。 */
  private async token(): Promise<string> {
    const s = this.session;
    if (!s) throw new CloudError('auth', '尚未登入', 401);
    if (s.expiresAt - this.now() / 1000 > REFRESH_MARGIN_S) return s.idToken;
    const fresh = await this.refresh();
    if (!fresh) throw new CloudError('auth', '登入已失效，請重新登入', 401);
    return fresh.idToken;
  }

  private refresh(): Promise<Session | null> {
    if (this.refreshing) return this.refreshing;
    const current = this.session;
    if (!current) return Promise.resolve(null);
    this.refreshing = (async () => {
      try {
        const res = await this.raw('POST', `${this.ep.token}?key=${encodeURIComponent(this.cfg.apiKey)}`, {
          form: `grant_type=refresh_token&refresh_token=${encodeURIComponent(current.refreshToken)}`,
        });
        if (!res || typeof res.id_token !== 'string' || typeof res.refresh_token !== 'string') throw new CloudError('server', '登入回應格式不對');
        const s: Session = {
          ...current,
          idToken: res.id_token,
          refreshToken: res.refresh_token,
          expiresAt: Math.floor(this.now() / 1000) + (Number(res.expires_in) || 3600),
        };
        // 換新途中已經登出或換人，就不要把舊帳號寫回去
        if (this.session !== current) return this.session;
        await this.setSession(s);
        return s;
      } catch (e) {
        // 被拒絕＝真的失效了（帳號被刪、憑證作廢），登出；沒網路或伺服器錯誤則保留登入狀態，之後再試
        if (e instanceof CloudError && (e.kind === 'auth' || e.kind === 'invalid')) {
          if (this.session === current) await this.setSession(null);
          return null;
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Auth API（用 API 金鑰，不帶登入憑證） */
  private authCall(method: string, body: object): Promise<any> {
    return this.raw('POST', `${this.ep.auth}/${method}?key=${encodeURIComponent(this.cfg.apiKey)}`, { body, headers: { 'X-Firebase-Locale': 'zh-TW' } });
  }

  /** Firestore API（帶登入憑證） */
  private async call(method: string, url: string, body?: unknown): Promise<any> {
    const token = await this.token();
    try {
      return await this.raw(method, url, { body, token });
    } catch (e) {
      // 憑證提早失效：換新的再試一次
      if (e instanceof CloudError && e.status === 401 && this.session) {
        const fresh = await this.refresh();
        if (fresh) return this.raw(method, url, { body, token: fresh.idToken });
      }
      throw e;
    }
  }

  private async raw(method: string, url: string, opts: { body?: unknown; form?: string; token?: string; headers?: Record<string, string> } = {}): Promise<any> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.form !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Awaited<ReturnType<FetchLike>>;
    let text: string;
    try {
      res = await this.fetchImpl(url, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
      text = await res.text();
    } catch (e: any) {
      throw new CloudError('network', `連不上雲端（${e?.message ?? '網路錯誤'}）`);
    }
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (res.ok) return json;
    throw toError(res.status, json);
  }
}

function toDoc(raw: any): Doc | null {
  if (!raw || typeof raw.name !== 'string') return null;
  return { id: raw.name.slice(raw.name.lastIndexOf('/') + 1), data: decodeFields(raw.fields) };
}

/** Auth 錯誤代碼 → 可以直接顯示給使用者的說明 */
const AUTH_MESSAGES: Record<string, [CloudErrorKind, string]> = {
  INVALID_OOB_CODE: ['invalid', '這個登入連結已經用過或失效了，請重新寄一封登入信'],
  EXPIRED_OOB_CODE: ['invalid', '這個登入連結過期了，請重新寄一封登入信'],
  INVALID_EMAIL: ['invalid', '這個連結不是寄給這個 Email 的，請確認 Email 或重新寄一封登入信'],
  MISSING_EMAIL: ['invalid', 'Email 格式不對'],
  QUOTA_EXCEEDED: ['rate-limit', '今天的登入信額度用完了，請明天再試'],
  TOO_MANY_ATTEMPTS_TRY_LATER: ['rate-limit', '太頻繁了，請稍等一下再試'],
  OPERATION_NOT_ALLOWED: ['server', '雲端還沒開啟 Email 連結登入'],
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: ['auth', '為了安全，請先登出再重新登入，然後在幾分鐘內進行這個操作'],
  USER_DISABLED: ['auth', '這個帳號已被停用'],
  USER_NOT_FOUND: ['auth', '登入已失效，請重新登入'],
  TOKEN_EXPIRED: ['auth', '登入已失效，請重新登入'],
  INVALID_REFRESH_TOKEN: ['auth', '登入已失效，請重新登入'],
  INVALID_ID_TOKEN: ['auth', '登入已失效，請重新登入'],
};

function toError(status: number, json: any): CloudError {
  const err = (Array.isArray(json) ? json[0]?.error : json?.error) ?? {};
  const detail: string = typeof err === 'string' ? err : (err.message ?? '');
  // Auth 的錯誤代碼放在 message（可能帶說明：「QUOTA_EXCEEDED : ...」），Firestore 的放在 status
  const authCode = /^[A-Z][A-Z0-9_]+/.exec(detail)?.[0];
  const code: string | undefined = (typeof err.status === 'string' ? err.status : undefined) ?? authCode;
  const known = authCode ? AUTH_MESSAGES[authCode] : undefined;
  if (known) return new CloudError(known[0], known[1], status, authCode);
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new CloudError('rate-limit', '太頻繁了，請稍等一下再試', status, code);
  if (status === 409) return new CloudError('conflict', '資料重複或同時被修改', status, code);
  if (status === 401) return new CloudError('auth', '登入已失效，請重新登入', status, code);
  if (status === 403) return new CloudError('invalid', '沒有權限進行這個操作', status, code);
  if (status >= 500) return new CloudError('server', `雲端暫時有問題（${status}）`, status, code);
  return new CloudError('invalid', detail || `請求被拒絕（${status}）`, status, code);
}
