/** Document text extraction, chunking and similarity utilities. */

export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const paragraphs = clean.split(/\n\n/);
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = overlap > 0 && current.length > overlap ? current.slice(-overlap) : '';
  };
  for (const para of paragraphs) {
    if (para.length > size) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (s.length > size) {
          for (let i = 0; i < s.length; i += size - overlap) {
            if (current.length + Math.min(size, s.length - i) > size) flush();
            current += (current ? ' ' : '') + s.slice(i, i + size);
          }
        } else {
          if (current.length + s.length + 1 > size) flush();
          current += (current ? ' ' : '') + s;
        }
      }
    } else {
      if (current.length + para.length + 2 > size) flush();
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim() && (!chunks.length || !chunks[chunks.length - 1]!.endsWith(current.trim()))) chunks.push(current.trim());
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export const SUPPORTED_DOCUMENT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html', 'application/pdf'];

export async function extractText(buffer: Buffer, mimeType: string, fileName = ''): Promise<string> {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdf = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string }>;
    return (await pdf(buffer)).text;
  }
  const text = buffer.toString('utf8');
  if (mimeType === 'text/html' || lower.endsWith('.html') || lower.endsWith('.htm')) return htmlToText(text);
  if (mimeType === 'application/json' || lower.endsWith('.json')) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}
