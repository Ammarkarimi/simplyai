export function formatDate(d: Date, fmt: string, timeZone = 'UTC'): string {
  if (fmt === 'ISO') return d.toISOString();
  if (fmt === 'unix') return String(Math.floor(d.getTime() / 1000));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'long' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const month = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long' }).format(d);
  const tokens: Record<string, string> = {
    YYYY: parts.year!, MMMM: month, MMM: month.slice(0, 3), MM: parts.month!, DD: parts.day!, dddd: parts.weekday!,
    HH: parts.hour === '24' ? '00' : parts.hour!, mm: parts.minute!, ss: parts.second!,
  };
  return fmt.replace(/YYYY|MMMM|MMM|MM|DD|dddd|HH|mm|ss/g, (t) => tokens[t] ?? t);
}
