import { decodeFields, decodeValue, encodeFields, type Fields, type Plain } from '../src/cloud/values';

/**
 * 測試用的假 Firebase（放在記憶體裡）：只實作 App 會用到的 Auth 與 Firestore REST 端點，
 * 並照 firestore.rules 的規則限制每個帳號讀得到、改得到的資料。
 * 這份假的行為有沒有和真的一致，由 npm run test:cloud 把同一批測試拿去 Firebase 模擬器（跑真的規則）再跑一次來確認。
 */
export class FakeFirebase {
  users = new Map<string, { uid: string; email: string }>();
  codes = new Map<string, string>();
  idTokens = new Map<string, { uid: string; exp: number }>();
  refreshTokens = new Map<string, string>();
  docs = new Map<string, Fields>();
  sent: { to: string; link: string }[] = [];
  nowS = 1_800_000_000;
  tokenLifeS = 3600;
  private seq = 0;

  constructor(readonly projectId: string) {}

  /** 回傳 [HTTP 狀態, JSON 內容] */
  handle(method: string, url: string, rawBody: string | undefined, headers: Record<string, string>): [number, any?] {
    const u = new URL(url);
    const p = u.pathname;
    // 正式網址（主機名稱就是服務）和模擬器網址（服務名稱在路徑裡）都認得
    const full = `${u.host}${p}`;
    if (full.endsWith('securetoken.googleapis.com/v1/token')) return this.refresh(new URLSearchParams(rawBody ?? ''));
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    if (full.includes('identitytoolkit.googleapis.com/v1/')) return this.auth(p.slice(p.lastIndexOf('/') + 1), body);
    const root = `/v1/projects/${this.projectId}/databases/(default)/documents`;
    if (!p.startsWith(root)) return [404, err(404, 'NOT_FOUND', `假雲端沒有這個端點：${method} ${p}`)];

    const bearer = (headers.Authorization ?? '').replace('Bearer ', '');
    const sess = this.idTokens.get(bearer);
    if (bearer && (!sess || sess.exp <= this.nowS)) return [401, err(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.')];
    const user = sess ? ([...this.users.values()].find((x) => x.uid === sess.uid) ?? null) : null;
    const rest = p.slice(root.length);
    if (rest === ':commit') return this.commit(body.writes ?? [], user);
    if (rest === ':runQuery') return this.runQuery(body.structuredQuery, user);
    if (rest === ':batchGet') return this.batchGet(body.documents ?? [], user);
    if (method === 'GET' && rest.startsWith('/')) {
      const path = rest.slice(1).split('/').map(decodeURIComponent).join('/');
      if (!this.canGet(path, user)) return [403, DENIED];
      const data = this.docs.get(path);
      return data ? [200, this.toDocument(path, data)] : [404, err(404, 'NOT_FOUND', 'Document not found.')];
    }
    return [404, err(404, 'NOT_FOUND', `假雲端沒有這個端點：${method} ${p}`)];
  }

  // ───────────── Auth ─────────────

  private auth(action: string, body: any): [number, any?] {
    if (action === 'accounts:sendOobCode') {
      if (body.requestType !== 'EMAIL_SIGNIN' || !body.continueUrl) return [400, authErr('INVALID_CONTINUE_URI')];
      const code = `code-${++this.seq}-${'x'.repeat(20)}`;
      this.codes.set(code, body.email);
      const link = `https://${this.projectId}.firebaseapp.com/__/auth/action?apiKey=fake&mode=signIn&oobCode=${code}&continueUrl=${encodeURIComponent(body.continueUrl)}&lang=zh-TW`;
      this.sent.push({ to: body.email, link });
      return [200, { kind: 'identitytoolkit#GetOobConfirmationCodeResponse', email: body.email }];
    }
    if (action === 'accounts:signInWithEmailLink') {
      const email = this.codes.get(body.oobCode);
      if (!email) return [400, authErr('INVALID_OOB_CODE')];
      if (email !== body.email) return [400, authErr('INVALID_EMAIL')];
      this.codes.delete(body.oobCode);
      let user = this.users.get(email);
      const isNewUser = !user;
      if (!user) {
        user = { uid: `user${String(this.users.size + 1).padStart(4, '0')}${'0'.repeat(20)}`, email };
        this.users.set(email, user);
      }
      const n = ++this.seq;
      const refreshToken = `rt-${user.uid}-${n}`;
      this.refreshTokens.set(refreshToken, user.uid);
      return [200, { idToken: this.issue(user.uid), refreshToken, expiresIn: String(this.tokenLifeS), localId: user.uid, email, isNewUser }];
    }
    if (action === 'accounts:delete') {
      const sess = this.idTokens.get(body.idToken);
      if (!sess || sess.exp <= this.nowS) return [400, authErr('INVALID_ID_TOKEN')];
      this.forget(sess.uid);
      return [200, { kind: 'identitytoolkit#DeleteAccountResponse' }];
    }
    return [404, authErr('NOT_FOUND')];
  }

  private issue(uid: string): string {
    const token = `id-${uid}-${++this.seq}`;
    this.idTokens.set(token, { uid, exp: this.nowS + this.tokenLifeS });
    return token;
  }

  private refresh(form: URLSearchParams): [number, any?] {
    const refreshToken = form.get('refresh_token') ?? '';
    const uid = this.refreshTokens.get(refreshToken);
    if (form.get('grant_type') !== 'refresh_token' || !uid) return [400, authErr('INVALID_REFRESH_TOKEN')];
    return [200, { id_token: this.issue(uid), refresh_token: refreshToken, expires_in: String(this.tokenLifeS), user_id: uid, token_type: 'Bearer' }];
  }

  /** 把帳號從伺服器上拿掉（登入憑證全部作廢） */
  forget(uid: string) {
    for (const [email, user] of this.users) if (user.uid === uid) this.users.delete(email);
    for (const [t, s] of this.idTokens) if (s.uid === uid) this.idTokens.delete(t);
    for (const [t, id] of this.refreshTokens) if (id === uid) this.refreshTokens.delete(t);
  }

  // ───────────── Firestore ─────────────

  private name(path: string) {
    return `projects/${this.projectId}/databases/(default)/documents/${path}`;
  }

  private path(name: string) {
    return name.slice(this.name('').length);
  }

  private toDocument(path: string, data: Fields) {
    return { name: this.name(path), fields: encodeFields(data) };
  }

  private batchGet(names: string[], user: User): [number, any?] {
    const out: any[] = [];
    for (const name of names) {
      const path = this.path(name);
      if (!this.canGet(path, user)) return [403, DENIED];
      const data = this.docs.get(path);
      out.push(data ? { found: this.toDocument(path, data) } : { missing: name });
    }
    return [200, out];
  }

  private runQuery(q: any, user: User): [number, any?] {
    const collection: string = q.from?.[0]?.collectionId;
    const conds: any[] = q.where?.compositeFilter ? q.where.compositeFilter.filters : q.where ? [q.where] : [];
    const filters = conds.map((c) => ({ field: c.fieldFilter.field.fieldPath as string, op: c.fieldFilter.op as string, value: decodeValue(c.fieldFilter.value) }));
    if (!this.canList(collection, filters, user)) return [403, DENIED];
    const after: string | null = q.startAt?.values?.[0]?.referenceValue ?? null;
    const rows = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(`${collection}/`) && path.split('/').length === 2)
      .filter(([, data]) =>
        filters.every((f) => {
          const v = data[f.field];
          if (f.op === 'EQUAL') return v === f.value;
          if (f.op === 'ARRAY_CONTAINS') return Array.isArray(v) && v.includes(f.value);
          throw new Error(`假雲端不支援的查詢條件：${f.op}`);
        }),
      )
      .map(([path, data]) => this.toDocument(path, data))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .filter((d) => !after || d.name > after)
      .slice(0, q.limit ?? Infinity);
    return [200, rows.length ? rows.map((document) => ({ document })) : [{ readTime: 'now' }]];
  }

  private commit(writes: any[], user: User): [number, any?] {
    const after = new Map(this.docs);
    const changed: { path: string; before: Fields | undefined; after: Fields | undefined }[] = [];
    for (const w of writes) {
      const path = this.path(w.delete ?? w.update.name);
      const before = after.get(path);
      const pre = w.currentDocument?.exists;
      let next: Fields | undefined;
      if (!w.delete) {
        const data = decodeFields(w.update.fields);
        next = w.updateMask ? { ...before } : data;
        if (w.updateMask) for (const f of w.updateMask.fieldPaths as string[]) next[f] = data[f];
      }
      changed.push({ path, before, after: next, ...(pre === undefined ? {} : { pre }) } as any);
      if (next) after.set(path, next);
      else after.delete(path);
    }
    // 先看權限規則，再看前提條件。帶「必須還不存在」前提的寫入，規則把它當成新增來檢查（和模擬器實測一致）
    for (const c of changed as any[]) if (!this.canWrite(c.path, c.pre === false ? undefined : c.before, c.after, user, after)) return [403, DENIED];
    for (const c of changed as any[]) {
      if (c.pre === false && c.before) return [409, err(409, 'ALREADY_EXISTS', 'Document already exists')];
      if (c.pre === true && !c.before) return [404, err(404, 'NOT_FOUND', 'No document to update')];
    }
    this.docs = after;
    return [200, { writeResults: writes.map(() => ({})), commitTime: 'now' }];
  }

  // ───────────── 權限規則（對照 firestore.rules） ─────────────

  private canGet(path: string, user: User): boolean {
    if (!user) return false;
    const [collection] = path.split('/');
    if (collection === 'users' || collection === 'nicknames' || collection === 'emails') return true;
    if (collection === 'results') {
      const d = this.docs.get(path);
      return !!d && (d.owner === user.uid || d.taggedTo === user.uid);
    }
    if (collection === 'runs') return this.docs.get(path)?.owner === user.uid;
    return false;
  }

  private canList(collection: string, filters: { field: string; op: string; value: Plain }[], user: User): boolean {
    if (!user) return false;
    if (collection === 'users') return true;
    // 查詢條件本身要能保證每一筆結果都是自己讀得到的
    if (collection === 'results') return filters.some((f) => f.op === 'EQUAL' && (f.field === 'owner' || f.field === 'taggedTo') && f.value === user.uid);
    if (collection === 'runs') return filters.some((f) => f.op === 'EQUAL' && f.field === 'owner' && f.value === user.uid);
    return false;
  }

  private canWrite(path: string, before: Fields | undefined, next: Fields | undefined, user: User, after: Map<string, Fields>): boolean {
    if (!user) return false;
    const me = user.uid;
    const [collection, id] = path.split('/');
    if (collection === 'users') {
      if (id !== me) return false;
      if (!next) return true;
      return validUser(next) && after.get(`nicknames/${next.nicknameKey}`)?.uid === me;
    }
    if (collection === 'nicknames') {
      const mine = after.get(`users/${me}`);
      if (!before && next) return onlyKeys(next, ['uid']) && next.uid === me && !!mine && mine.nicknameKey === id;
      if (before && !next) return before.uid === me && (!mine || mine.nicknameKey !== id);
      return false;
    }
    if (collection === 'emails') {
      if (next) return user.email.toLowerCase() === id && onlyKeys(next, ['uid']) && next.uid === me;
      return !!before && before.uid === me;
    }
    if (collection === 'results') {
      if (!next) return !!before && before.owner === me;
      if (!before) return validResult(next, me);
      if (before.owner === me) return validResult(next, me) && next.raceId === before.raceId;
      if (before.taggedTo === me) {
        const touched = [...new Set([...Object.keys(before), ...Object.keys(next)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
        return touched.every((k) => ['runner', 'taggedTo', 'runnerName'].includes(k)) && next.runner === null && next.taggedTo === null && nameOk(next.runnerName);
      }
      return false;
    }
    if (collection === 'runs') {
      if (!next) return !!before && before.owner === me;
      return (!before || before.owner === me) && validRun(next, me);
    }
    return false;
  }
}

type User = { uid: string; email: string } | null;

const DENIED = err(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');

function err(code: number, status: string, message: string) {
  return { error: { code, message, status } };
}

function authErr(message: string) {
  return { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } };
}

function onlyKeys(d: Fields, allowed: string[]): boolean {
  return Object.keys(d).every((k) => allowed.includes(k));
}

function nameOk(v: Plain | undefined): boolean {
  return v === null || (typeof v === 'string' && v.length <= 40);
}

function validUser(d: Fields): boolean {
  const n = d.nickname;
  return (
    onlyKeys(d, ['nickname', 'nicknameKey', 'search']) &&
    typeof n === 'string' &&
    n.length >= 2 &&
    n.length <= 64 &&
    n.trim() === n &&
    !/[@/]/.test(n) &&
    // 規則的 lower() 只轉英文字母
    d.nicknameKey === n.replace(/[A-Z]/g, (c) => c.toLowerCase()) &&
    Array.isArray(d.search) &&
    d.search.length <= 160
  );
}

const RUN_KEYS = ['owner', 'ranAt', 'distanceM', 'durationS', 'targetM', 'completed', 'splitsS', 'track'];

function validRun(d: Fields, me: string): boolean {
  const num = (v: Plain | undefined, min: number, max: number) => typeof v === 'number' && v >= min && v <= max;
  return (
    onlyKeys(d, RUN_KEYS) &&
    RUN_KEYS.every((k) => k in d) &&
    d.owner === me &&
    typeof d.ranAt === 'string' &&
    d.ranAt.length >= 10 &&
    d.ranAt.length <= 40 &&
    num(d.distanceM, 0, 1000000) &&
    num(d.durationS, 0, 1000000) &&
    (d.targetM === null || (typeof d.targetM === 'number' && d.targetM > 0 && d.targetM <= 1000000)) &&
    typeof d.completed === 'boolean' &&
    Array.isArray(d.splitsS) &&
    d.splitsS.length <= 1000 &&
    Array.isArray(d.track) &&
    d.track.length <= 200 &&
    d.track.every((t) => typeof t === 'string') &&
    d.track.join('').length <= 300000
  );
}

const RESULT_KEYS = ['owner', 'raceId', 'ranAt', 'distanceM', 'mode', 'signal', 'place', 'time', 'official', 'reaction', 'falseStart', 'auto', 'runner', 'taggedTo', 'runnerName'];
const RESULT_REQUIRED = RESULT_KEYS.filter((k) => k !== 'signal' && k !== 'reaction');

function validResult(d: Fields, me: string): boolean {
  const num = (v: Plain | undefined, min: number, max: number) => typeof v === 'number' && v >= min && v < max;
  return (
    onlyKeys(d, RESULT_KEYS) &&
    RESULT_REQUIRED.every((k) => k in d) &&
    d.owner === me &&
    typeof d.raceId === 'string' &&
    d.raceId.length > 0 &&
    d.raceId.length <= 64 &&
    typeof d.ranAt === 'string' &&
    d.ranAt.length >= 10 &&
    d.ranAt.length <= 40 &&
    (d.distanceM === null || (typeof d.distanceM === 'number' && d.distanceM > 0 && d.distanceM <= 100000)) &&
    (d.mode === 'two-phone' || d.mode === 'single-phone') &&
    (d.signal === undefined || d.signal === null || d.signal === 'sound' || d.signal === 'flash') &&
    Number.isInteger(d.place) &&
    num(d.place, 1, 501) &&
    num(d.time, 0, 100000) &&
    num(d.official, 0, 100000) &&
    (d.reaction === undefined || d.reaction === null || (typeof d.reaction === 'number' && d.reaction > -100 && d.reaction < 100)) &&
    typeof d.falseStart === 'boolean' &&
    typeof d.auto === 'boolean' &&
    (d.runner === null || (typeof d.runner === 'string' && d.runner.length > 0 && d.runner.length <= 128)) &&
    d.taggedTo === (d.runner !== null && d.runner !== d.owner ? d.runner : null) &&
    nameOk(d.runnerName)
  );
}
