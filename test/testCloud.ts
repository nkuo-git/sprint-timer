import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Doc, type FetchLike } from '../src/cloud/client';
import type { CloudConfig } from '../src/cloud/config';
import { decodeFields } from '../src/cloud/values';
import { FakeFirebase } from './fakeFirebase';

/**
 * 測試用的雲端。平常是記憶體裡的假 Firebase（快、不用裝東西）；
 * 設了環境變數 FIREBASE_EMULATOR=1（npm run test:cloud）就改連本機的 Firebase 模擬器，
 * 用真的 Auth / Firestore 行為和真的 firestore.rules 跑同一批測試。
 */
export interface TestCloud {
  readonly config: CloudConfig;
  /** 交給 CloudClient 用的 fetch：可以模擬斷線，並記下每個請求 */
  readonly fetch: FetchLike;
  offline: boolean;
  /** App 以為的現在時間（秒）。往後調可以讓登入憑證「到期」。 */
  nowS: number;
  readonly tokenLifeS: number;
  /** 送出過的請求：「方法 路徑」 */
  requests: string[];
  /** 寄給這個 Email 的最新一封登入信裡的連結 */
  linkFor(email: string): Promise<string>;
  /** 寄過登入信的 Email（依寄出順序） */
  mailed(): Promise<string[]>;
  /** 以管理員身分讀出一個集合的所有文件（不受權限規則限制） */
  docs(collection: string): Promise<Doc[]>;
  /** 伺服器上的帳號全部消失（模擬帳號被刪、登入憑證作廢） */
  dropAccounts(): Promise<void>;
}

export const USE_EMULATOR = process.env.FIREBASE_EMULATOR === '1';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR ?? 'http://127.0.0.1:9099';
const FIRESTORE = process.env.FIRESTORE_EMULATOR ?? 'http://127.0.0.1:8080';
/** 模擬器啟動時指定的專案（emulators:exec 會放在 GCLOUD_PROJECT） */
const AUTH_PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sprint-timer';

let counter = 0;

export async function makeCloud(): Promise<TestCloud> {
  // 每個測試用自己的專案 ID，資料互不干擾
  const projectId = `demo-t${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return USE_EMULATOR ? EmulatorCloud.create(projectId) : new MemoryCloud(projectId);
}

abstract class BaseCloud {
  offline = false;
  nowS = 1_800_000_000;
  readonly tokenLifeS = 3600;
  requests: string[] = [];

  protected abstract send: FetchLike;

  readonly fetch: FetchLike = async (url, init) => {
    if (this.offline) throw new TypeError('Network request failed');
    this.requests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    return this.send(url, init);
  };
}

class MemoryCloud extends BaseCloud implements TestCloud {
  readonly server: FakeFirebase;
  readonly config: CloudConfig;

  constructor(projectId: string) {
    super();
    this.server = new FakeFirebase(projectId);
    this.config = { projectId, apiKey: 'fake-api-key', emulator: { auth: 'http://fake-auth', firestore: 'http://fake-firestore' } };
  }

  protected send: FetchLike = async (url, init) => {
    this.server.nowS = this.nowS;
    const [status, json] = this.server.handle(init?.method ?? 'GET', url, init?.body, init?.headers ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => (json === undefined ? '' : JSON.stringify(json)) };
  };

  async linkFor(email: string) {
    return this.server.sent.filter((m) => m.to === email).at(-1)?.link ?? '';
  }

  async mailed() {
    return this.server.sent.map((m) => m.to);
  }

  async docs(collection: string) {
    return [...this.server.docs.entries()]
      .filter(([path]) => path.startsWith(`${collection}/`))
      .map(([path, data]) => ({ id: path.slice(collection.length + 1), data }));
  }

  async dropAccounts() {
    for (const user of [...this.server.users.values()]) this.server.forget(user.uid);
  }
}

/**
 * 連本機模擬器。Firestore 每個測試用自己的專案 ID（資料互不干擾）；
 * Auth 模擬器不管專案 ID、所有測試共用同一批帳號，所以這個模式下測試檔要一個一個跑（--no-file-parallelism）。
 */
class EmulatorCloud extends BaseCloud implements TestCloud {
  readonly config: CloudConfig;
  private before = new Set<string>();
  private lastLink = new Map<string, string>();

  private constructor(private readonly projectId: string) {
    super();
    this.config = { projectId, apiKey: 'fake-api-key', emulator: { auth: AUTH, firestore: FIRESTORE } };
  }

  static async create(projectId: string): Promise<EmulatorCloud> {
    const cloud = new EmulatorCloud(projectId);
    // 把正式的規則檔套到這個測試專案
    const rules = readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8');
    const res = await fetch(`${FIRESTORE}/emulator/v1/projects/${projectId}:securityRules`, {
      method: 'PUT',
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
    });
    if (!res.ok) throw new Error(`規則載入失敗：${await res.text()}`);
    cloud.before = new Set((await cloud.oobCodes(true)).map((c) => c.oobLink));
    return cloud;
  }

  protected send: FetchLike = (url, init) => fetch(url, init);

  /** 這個測試寄出、還沒用掉的登入信（Auth 模擬器是所有測試共用的，別的測試留下的不算） */
  private async oobCodes(all = false): Promise<{ email: string; oobLink: string }[]> {
    const res = await fetch(`${AUTH}/emulator/v1/projects/${AUTH_PROJECT}/oobCodes`);
    const codes: { email: string; oobLink: string }[] = ((await res.json()) as any).oobCodes ?? [];
    return all ? codes : codes.filter((c) => !this.before.has(c.oobLink));
  }

  async linkFor(email: string) {
    // 模擬器會把用過的登入碼從清單拿掉，所以記住看過的，測試才拿得到「已經用過的連結」
    const link = (await this.oobCodes()).filter((c) => c.email === email).at(-1)?.oobLink;
    if (link) this.lastLink.set(email, link);
    return this.lastLink.get(email) ?? '';
  }

  async mailed() {
    return (await this.oobCodes()).map((c) => c.email);
  }

  async docs(collection: string) {
    const res = await fetch(`${FIRESTORE}/v1/projects/${this.projectId}/databases/(default)/documents/${collection}?pageSize=300`, {
      headers: { Authorization: 'Bearer owner' },
    });
    const docs: any[] = ((await res.json()) as any).documents ?? [];
    return docs.map((d) => ({ id: d.name.slice(d.name.lastIndexOf('/') + 1), data: decodeFields(d.fields) }));
  }

  async dropAccounts() {
    await fetch(`${AUTH}/emulator/v1/projects/${AUTH_PROJECT}/accounts`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
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
