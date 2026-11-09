const UNIT_MS: Record<string, number> = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };

export function addToDateSafe(date: Date, amount: number, unit: string): Date {
  if (!Number.isFinite(amount)) throw new Error('Amount must be a number');
  const d = new Date(date.getTime());
  if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + amount);
  else if (unit === 'years') d.setUTCFullYear(d.getUTCFullYear() + amount);
  else d.setTime(d.getTime() + amount * (UNIT_MS[unit] ?? 1000));
  return d;
}
