import type { CloudConfig } from './config';

/**
 * 很薄的 Supabase 用戶端：只用 fetch 呼叫 Auth（Email 驗證碼登入）和 REST API。
 * 不依賴 supabase-js，方便在 Node 測試，也不用替 React Native 補 polyfill。
 */

export interface CloudUser {
  id: string;
  email: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** access token 到期時間（epoch 秒） */
  expiresAt: number;
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
    /** Postgres / Auth 的錯誤代碼，例如 23505（重複）、otp_expired */
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length <= 254 && EMAIL_RE.test(e);
}

type Query = Record<string, string | number | undefined>;

export class CloudClient {
  private session: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();
  private refreshing: Promise<Session | null> | null = null;
  private loaded = false;

  constructor(
    private readonly cfg: CloudConfig,
    private readonly fetchImpl: FetchLike,
    private readonly storage: SessionStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get user(): CloudUser | null {
    return this.session?.user ?? null;
  }

  /** 登入狀態改變時通知（登入、登出、憑證失效） */
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
      const s = raw ? (JSON.parse(raw) as Session) : null;
      if (s && s.accessToken && s.refreshToken && s.user?.id) this.session = s;
    } catch {
      this.session = null;
    }
    return this.user;
  }

  /** 寄認證信（裡面有驗證碼）。第一次登入的 Email 會自動建立帳號。 */
  async requestCode(email: string): Promise<void> {
    const e = normalizeEmail(email);
    if (!isValidEmail(e)) throw new CloudError('invalid', 'Email 格式不對');
    await this.call('POST', '/auth/v1/otp', { body: { email: e, create_user: true }, auth: false });
  }

  /** 用認證信裡的驗證碼登入 */
  async verifyCode(email: string, code: string): Promise<CloudUser> {
    const token = code.replace(/\D/g, '');
    if (token.length < 6) throw new CloudError('invalid', '驗證碼不完整');
    const res = await this.call('POST', '/auth/v1/verify', { body: { type: 'email', email: normalizeEmail(email), token }, auth: false });
    const s = toSession(res, this.now());
    if (!s) throw new CloudError('server', '登入回應格式不對');
    await this.setSession(s);
    return s.user;
  }

  async signOut(): Promise<void> {
    const s = this.session;
    if (!s) return;
    try {
      await this.raw('POST', '/auth/v1/logout', { token: s.accessToken });
    } catch {
      // 沒網路也要能登出：本機的登入狀態照樣清掉
    }
    await this.setSession(null);
  }

  /** REST：讀資料表 */
  async select<T = any>(table: string, query: Query): Promise<T[]> {
    return (await this.call('GET', `/rest/v1/${table}`, { query })) ?? [];
  }

  /** REST：新增或覆蓋（依主鍵） */
  async upsert(table: string, rows: object | object[]): Promise<void> {
    await this.call('POST', `/rest/v1/${table}`, { body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
  }

  async insert(table: string, rows: object | object[]): Promise<void> {
    await this.call('POST', `/rest/v1/${table}`, { body: rows, prefer: 'return=minimal' });
  }

  async update(table: string, query: Query, patch: object): Promise<void> {
    await this.call('PATCH', `/rest/v1/${table}`, { query, body: patch, prefer: 'return=minimal' });
  }

  async remove(table: string, query: Query): Promise<void> {
    await this.call('DELETE', `/rest/v1/${table}`, { query, prefer: 'return=minimal' });
  }

  async rpc<T = any>(fn: string, args: object = {}): Promise<T> {
    return this.call('POST', `/rest/v1/rpc/${fn}`, { body: args });
  }

  // ───────────── 內部 ─────────────

  private async setSession(s: Session | null) {
    this.session = s;
    try {
      await this.storage.save(s ? JSON.stringify(s) : null);
    } catch {
      // 存不進去只影響下次開 App 要重新登入
    }
    for (const fn of this.listeners) fn(s);
  }

  /** 取得可用的 access token；快到期就先換新的。同時只會有一個換新請求（refresh token 只能用一次）。 */
  private async token(): Promise<string> {
    const s = this.session;
    if (!s) throw new CloudError('auth', '尚未登入', 401);
    if (s.expiresAt - this.now() / 1000 > REFRESH_MARGIN_S) return s.accessToken;
    const fresh = await this.refresh();
    if (!fresh) throw new CloudError('auth', '登入已失效，請重新登入', 401);
    return fresh.accessToken;
  }

  private refresh(): Promise<Session | null> {
    if (this.refreshing) return this.refreshing;
    const current = this.session;
    if (!current) return Promise.resolve(null);
    this.refreshing = (async () => {
      try {
        const res = await this.raw('POST', '/auth/v1/token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: current.refreshToken } });
        const s = toSession(res, this.now());
        if (!s) throw new CloudError('server', '登入回應格式不對');
        await this.setSession(s);
        return s;
      } catch (e) {
        // refresh token 被拒絕＝真的失效了，登出；沒網路或伺服器錯誤則保留登入狀態，之後再試
        if (e instanceof CloudError && (e.kind === 'auth' || e.kind === 'invalid')) {
          await this.setSession(null);
          return null;
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async call(method: string, path: string, opts: { query?: Query; body?: unknown; prefer?: string; auth?: boolean } = {}): Promise<any> {
    if (opts.auth === false) return this.raw(method, path, opts);
    const token = await this.token();
    try {
      return await this.raw(method, path, { ...opts, token });
    } catch (e) {
      // access token 提早失效（例如伺服器端登出全部裝置）：換新的再試一次
      if (e instanceof CloudError && e.status === 401 && this.session) {
        const fresh = await this.refresh();
        if (fresh) return this.raw(method, path, { ...opts, token: fresh.accessToken });
      }
      throw e;
    }
  }

  private async raw(method: string, path: string, opts: { query?: Query; body?: unknown; prefer?: string; token?: string } = {}): Promise<any> {
    const qs = Object.entries(opts.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.cfg.url.replace(/\/+$/, '')}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { apikey: this.cfg.key, Authorization: `Bearer ${opts.token ?? this.cfg.key}` };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.prefer) headers.Prefer = opts.prefer;
    let res: Awaited<ReturnType<FetchLike>>;
    let text: string;
    try {
      res = await this.fetchImpl(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
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

function toSession(res: any, nowMs: number): Session | null {
  if (!res || typeof res.access_token !== 'string' || typeof res.refresh_token !== 'string' || !res.user?.id) return null;
  const expiresAt = typeof res.expires_at === 'number' ? res.expires_at : Math.floor(nowMs / 1000) + (Number(res.expires_in) || 3600);
  return { accessToken: res.access_token, refreshToken: res.refresh_token, expiresAt, user: { id: res.user.id, email: res.user.email ?? '' } };
}

function toError(status: number, json: any): CloudError {
  const code: string | undefined = json?.error_code ?? json?.code ?? (typeof json?.error === 'string' ? json.error : undefined);
  const detail: string = json?.msg ?? json?.message ?? json?.error_description ?? '';
  if (status === 429) return new CloudError('rate-limit', '太頻繁了，請稍等一下再試', status, code);
  if (status === 409 || code === '23505') return new CloudError('conflict', '資料重複', status, code);
  if (status === 401) return new CloudError('auth', '登入已失效，請重新登入', status, code);
  if (status === 403 && (code === 'otp_expired' || /expired|invalid/i.test(detail))) return new CloudError('invalid', '驗證碼不對或已過期', status, code);
  if (status >= 500) return new CloudError('server', `雲端暫時有問題（${status}）`, status, code);
  // 其餘 4xx：請求內容被拒絕（驗證碼錯、refresh token 無效、違反資料規則…）
  return new CloudError('invalid', detail || `請求被拒絕（${status}）`, status, code);
}
