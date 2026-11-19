/**
 * Firestore REST API 的資料格式轉換：每個值都包成 { stringValue: ... } 這類帶型別的物件。
 * 這裡只處理 App 用得到的型別（null、布林、數字、字串、陣列、物件）。
 */

export type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };
export type Fields = Record<string, Plain>;

export function encodeValue(v: Plain): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(data: Fields): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = encodeValue(v);
  return out;
}

export function decodeValue(v: any): Plain {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('timestampValue' in v) return String(v.timestampValue);
  if ('referenceValue' in v) return String(v.referenceValue);
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue?.fields);
  return null;
}

export function decodeFields(fields: Record<string, any> | undefined): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}
