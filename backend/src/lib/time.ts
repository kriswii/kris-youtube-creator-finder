export function nowIso(): string {
  return new Date().toISOString();
}

export function safeDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${String(value)}`);
  }
  return date;
}
