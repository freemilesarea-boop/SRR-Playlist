/**
 * guideMarkdown — 엔터프라이즈 가이드 본문(마크다운) 편집·표시 도우미.
 */

/** 본문 링크로 살릴 주소: http(s)·mailto·사이트 내부 경로·문서 안 앵커만. 나머지(javascript: 등)는 버린다. */
export function safeGuideHref(href: string | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (h.startsWith('#')) return h;
  return null;
}

/** 마크다운 텍스트에서 [start,end) 를 감싸거나 줄 앞에 붙인다. 결과 텍스트와 새 커서 위치. */
export function applyMarkdown(
  text: string, start: number, end: number,
  kind: 'h2' | 'bold' | 'list' | 'link' | 'insert', insert = '',
): { text: string; cursor: number } {
  const sel = text.slice(start, end);
  if (kind === 'bold') {
    const inner = sel || '굵은 글씨';
    const out = `**${inner}**`;
    return { text: text.slice(0, start) + out + text.slice(end), cursor: start + out.length };
  }
  if (kind === 'link') {
    const inner = sel || '링크 글자';
    const out = `[${inner}](https://)`;
    return { text: text.slice(0, start) + out + text.slice(end), cursor: start + out.length - 1 };
  }
  if (kind === 'insert') {
    const before = text.slice(0, start);
    const pad = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const out = `${pad}${insert}\n\n`;
    return { text: before + out + text.slice(end), cursor: start + out.length };
  }
  // 줄 단위: 선택한 줄들(없으면 커서가 있는 줄) 앞에 접두어
  const prefix = kind === 'h2' ? '## ' : '- ';
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = text.indexOf('\n', Math.max(end, start));
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const block = text.slice(lineStart, lineEnd)
    .split('\n')
    .map((l) => (l.startsWith(prefix) ? l : prefix + l.replace(/^(#{1,6} |- )/, '')))
    .join('\n');
  return { text: text.slice(0, lineStart) + block + text.slice(lineEnd), cursor: lineStart + block.length };
}
