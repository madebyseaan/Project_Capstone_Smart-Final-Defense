const locks = new Map<string, Promise<unknown>>();

export function withSectionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = locks.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => locks.delete(key));
  locks.set(key, p);
  return p;
}
