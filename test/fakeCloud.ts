import type { FetchLike } from '../src/cloud/client';

/**
 * 測試用的假 Supabase：只實作 App 會用到的 Auth 與 REST 端點，
 * 並照 supabase/migrations 的 RLS 規則限制每個帳號看得到、改得到的資料。
 */
export class FakeCloud {
  users = new Map<string, { id: string; email: string; code: string | null }>();
  access = new Map<string, { uid: string; exp: number }>();
  refreshTokens = new Map<string, string>();
  profiles: { id: string; nickname: string }[] = [];
  races: any[] = [];
  results: any[] = [];
  sentEmails: { to: string; code: string }[] = [];
  requests: string[] = [];
  offline = false;
  nowS = 1_800_000_000;
  tokenLifeS = 3600;
  private seq = 0;

  readonly fetch: FetchLike = async (url, init) => {
    if (this.offline) throw new TypeError('Network request failed');
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    this.requests.push(`${method} ${u.pathname}`);
    const [status, json] = this.route(method, u, body, init?.headers ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => (json === undefined ? '' : JSON.stringify(json)) };
  };

  codeFor(email: string): string {
    return this.users.get(email)?.code ?? '';
  }

  private issue(uid: string) {
    const n = ++this.seq;
    const access_token = `at-${uid}-${n}`;
    const refresh_token = `rt-${uid}-${n}`;
    this.access.set(access_token, { uid, exp: this.nowS + this.tokenLifeS });
    this.refreshTokens.set(refresh_token, uid);
    const user = [...this.users.values()].find((x) => x.id === uid)!;
    return { access_token, refresh_token, expires_in: this.tokenLifeS, expires_at: this.nowS + this.tokenLifeS, user: { id: uid, email: user.email } };
  }

  private route(method: string, u: URL, body: any, headers: Record<string, string>): [number, any?] {
    const p = u.pathname;
    const q = u.searchParams;
    if (p === '/auth/v1/otp') {
      let user = this.users.get(body.email);
      if (!user) {
        user = { id: `00000000-0000-4000-8000-${String(this.users.size + 1).padStart(12, '0')}`, email: body.email, code: null };
        this.users.set(body.email, user);
      }
      user.code = String(100000 + ((this.sentEmails.length * 7919 + 482916) % 900000));
      this.sentEmails.push({ to: body.email, code: user.code });
      return [200, {}];
    }
    if (p === '/auth/v1/verify') {
      const user = this.users.get(body.email);
      if (!user || !user.code || user.code !== body.token) return [403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }];
      user.code = null;
      return [200, this.issue(user.id)];
    }
    if (p === '/auth/v1/token') {
      const uid = this.refreshTokens.get(body.refresh_token);
      if (!uid) return [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }];
      this.refreshTokens.delete(body.refresh_token);
      return [200, this.issue(uid)];
    }
    const bearer = (headers.Authorization ?? '').replace('Bearer ', '');
    const sess = this.access.get(bearer);
    const uid = sess && sess.exp > this.nowS ? sess.uid : null;
    if (p === '/auth/v1/logout') {
      if (uid) for (const [t, s] of this.access) if (s.uid === uid) this.access.delete(t);
      return [204];
    }
    if (!uid) return [401, { code: 'PGRST301', message: 'JWT expired' }];

    if (p === '/rest/v1/rpc/search_profiles') {
      const needle = String(body.q).trim().toLowerCase();
      if (needle.includes('@')) {
        const user = this.users.get(needle);
        return [200, this.profiles.filter((x) => x.id === user?.id)];
      }
      return [200, this.profiles.filter((x) => x.nickname.toLowerCase().includes(needle)).slice(0, 10)];
    }
    if (p === '/rest/v1/rpc/untag_me') {
      for (const r of this.results) {
        if (r.id === body.result_id && r.runner === uid) {
          r.runner_name = r.runner_name ?? this.profiles.find((x) => x.id === uid)?.nickname ?? null;
          r.runner = null;
        }
      }
      return [204];
    }
    if (p === '/rest/v1/rpc/delete_my_account') {
      const mine = new Set(this.races.filter((r) => r.owner === uid).map((r) => r.id));
      this.races = this.races.filter((r) => r.owner !== uid);
      this.results = this.results.filter((r) => !mine.has(r.race_id));
      for (const r of this.results) if (r.runner === uid) r.runner = null;
      this.profiles = this.profiles.filter((x) => x.id !== uid);
      for (const [email, user] of this.users) if (user.id === uid) this.users.delete(email);
      for (const [t, s] of this.access) if (s.uid === uid) this.access.delete(t);
      for (const [t, id] of this.refreshTokens) if (id === uid) this.refreshTokens.delete(t);
      return [204];
    }

    const table = p.replace('/rest/v1/', '');
    const match = (row: any) => {
      for (const [k, v] of q) {
        if (k === 'select' || k === 'order' || k === 'limit') continue;
        const col = k === 'nickname_key' ? String(row.nickname).toLowerCase() : row[k];
        if (v.startsWith('eq.')) {
          if (String(col) !== v.slice(3)) return false;
        } else if (v.startsWith('in.(')) {
          if (!v.slice(4, -1).split(',').includes(String(col))) return false;
        } else if (v.startsWith('not.in.(')) {
          if (v.slice(8, -1).split(',').includes(String(col))) return false;
        } else throw new Error(`假雲端不支援的條件：${k}=${v}`);
      }
      return true;
    };
    const ownsRace = (raceId: string) => this.races.some((r) => r.id === raceId && r.owner === uid);

    if (table === 'profiles') {
      if (method === 'GET') return [200, this.profiles.filter(match)];
      if (method === 'POST') {
        if (body.id !== uid) return [403, { code: '42501', message: 'new row violates row-level security policy' }];
        const n = [...String(body.nickname)].length;
        if (n < 2 || n > 16) return [400, { code: '23514', message: 'violates check constraint' }];
        if (this.profiles.some((x) => x.id !== uid && x.nickname.toLowerCase() === String(body.nickname).toLowerCase())) {
          return [409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_nickname_key"' }];
        }
        this.profiles = [...this.profiles.filter((x) => x.id !== uid), { id: uid, nickname: body.nickname }];
        return [201];
      }
    }
    if (table === 'races') {
      if (method === 'GET') {
        const visible = this.races.filter((r) => r.owner === uid || this.results.some((x) => x.race_id === r.id && x.runner === uid));
        return [200, visible.filter(match).map((r) => ({ ...r, results: this.results.filter((x) => x.race_id === r.id && (r.owner === uid || x.runner === uid)) }))];
      }
      if (method === 'POST') {
        const old = this.races.find((r) => r.id === body.id);
        if (body.owner !== uid || (old && old.owner !== uid)) return [403, { code: '42501', message: 'new row violates row-level security policy' }];
        if (old) Object.assign(old, body);
        else this.races.push({ ...body });
        return [201];
      }
      if (method === 'DELETE') {
        const gone = new Set(this.races.filter((r) => r.owner === uid && match(r)).map((r) => r.id));
        this.races = this.races.filter((r) => !gone.has(r.id));
        this.results = this.results.filter((r) => !gone.has(r.race_id));
        return [204];
      }
    }
    if (table === 'results') {
      if (method === 'GET') {
        const visible = this.results.filter((r) => r.runner === uid || ownsRace(r.race_id));
        return [200, visible.filter(match).map((r) => ({ ...r, race: this.races.find((x) => x.id === r.race_id) }))];
      }
      if (method === 'POST') {
        for (const row of body as any[]) {
          const old = this.results.find((r) => r.id === row.id);
          if (!ownsRace(row.race_id) || (old && !ownsRace(old.race_id))) return [403, { code: '42501', message: 'new row violates row-level security policy' }];
        }
        for (const row of body as any[]) {
          const old = this.results.find((r) => r.id === row.id);
          if (old) Object.assign(old, row);
          else this.results.push({ ...row });
        }
        return [201];
      }
      if (method === 'DELETE') {
        this.results = this.results.filter((r) => !(ownsRace(r.race_id) && match(r)));
        return [204];
      }
    }
    return [404, { message: `假雲端沒有這個端點：${method} ${p}` }];
  }
}

export function memoryStorage(initial: string | null = null) {
  const box = { value: initial };
  return {
    box,
    load: async () => box.value,
    save: async (v: string | null) => {
      box.value = v;
    },
  };
}
