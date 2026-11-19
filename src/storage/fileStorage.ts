import { File, Paths } from 'expo-file-system';

/**
 * 把一個字串存成 App 文件資料夾裡的檔案（登入狀態、成績紀錄用）。
 * 先寫到暫存檔再換過去，寫到一半 App 被關掉也不會弄壞原本的檔案。
 */
export function fileStorage(name: string) {
  const main = () => new File(Paths.document, name);
  const temp = () => new File(Paths.document, `${name}.tmp`);
  return {
    async load(): Promise<string | null> {
      const f = main();
      return f.exists ? f.text() : null;
    },
    async save(value: string | null): Promise<void> {
      const f = main();
      if (value === null) {
        if (f.exists) f.delete();
        return;
      }
      const t = temp();
      t.create({ overwrite: true });
      await t.write(value);
      t.moveSync(f, { overwrite: true });
    },
  };
}
