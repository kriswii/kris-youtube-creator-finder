export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJsonObject<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
