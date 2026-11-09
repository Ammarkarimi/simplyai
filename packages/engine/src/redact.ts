/** Replace known secret values in any structure before it is persisted or logged. */
export function createRedactor(secretValues: Iterable<string>): <T>(value: T) => T {
  const secrets = [...new Set([...secretValues].filter((s) => typeof s === 'string' && s.length >= 6))].sort((a, b) => b.length - a.length);
  if (!secrets.length) return (v) => v;
  const redactString = (s: string) => {
    let out = s;
    for (const sec of secrets) if (out.includes(sec)) out = out.split(sec).join('[REDACTED]');
    return out;
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 50) return v;
    if (typeof v === 'string') return redactString(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, depth + 1);
      return out;
    }
    return v;
  };
  return <T>(value: T) => walk(value, 0) as T;
}
