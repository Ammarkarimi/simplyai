'use client';
/** Small Markdown renderer producing React elements (no HTML injection). */
import * as React from 'react';
import { safeUrl } from '@simplyai/shared';

function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|~~([^~]+)~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2] || m[3]) out.push(<strong key={k}>{inline(m[2] ?? m[3]!, i)}</strong>);
    else if (m[4] || m[5]) out.push(<em key={k}>{inline(m[4] ?? m[5]!, i)}</em>);
    else if (m[6]) out.push(<code key={k} className="sai-code">{m[6]}</code>);
    else if (m[7]) {
      const href = safeUrl(m[8]);
      out.push(href ? <a key={k} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" className="sai-link">{m[7]}</a> : <span key={k}>{m[7]}</span>);
    } else if (m[9]) out.push(<del key={k}>{m[9]}</del>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key++} className="sai-pre"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = `h${h[1]!.length}` as 'h1';
      blocks.push(<Tag key={key++}>{inline(h[2]!)}</Tag>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="sai-hr" />);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={key++}>{items.map((it, j) => <li key={j}>{inline(it, j)}</li>)}</List>);
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) quote.push(lines[i++]!.replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key++} className="sai-quote">{inline(quote.join(' '))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s+)/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return <>{blocks}</>;
}
