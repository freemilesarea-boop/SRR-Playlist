/**
 * ContractMarkdown — 계약서 본문 전용 미니 마크다운 렌더러.
 *
 * 지원 구문 (계약서에 사용되는 것만):
 *   # H1                → 조항 헤더 (제N조)
 *   ## H2               → 섹션 헤더 (계약 핵심 요약)
 *   ### H3              → 보조 헤더
 *   * item              → 불릿
 *   1. item / 2. item   → 번호 리스트
 *   **bold**            → 강조
 *   ---                 → 구분선
 *
 * 동의란 (`# 동의` 섹션) 은 placeholder underscores 만 있어 더미처럼 보이므로
 * 렌더링에서 제외 (skipFromHeading 으로 cut-off).
 *
 * 외부 markdown 라이브러리 의존성 없음.
 */
import React from 'react';

function parseInline(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let buf = '';
  let i = 0;
  let partIdx = 0;
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > 0) {
        if (buf) {
          parts.push(buf);
          buf = '';
        }
        parts.push(
          <strong key={`${keyBase}-${partIdx++}`} className="font-bold text-ink">
            {text.slice(i + 2, end)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    buf += text[i++];
  }
  if (buf) parts.push(buf);
  return parts;
}

interface Props {
  body: string;
  /** 지정한 H1 헤더 텍스트가 나오면 그 이후는 렌더링 제외. 동의란 같은 placeholder section 숨김용. */
  skipFromHeading?: string;
  className?: string;
}

export default function ContractMarkdown({ body, skipFromHeading, className = '' }: Props) {
  const lines = body.split('\n');
  const blocks: React.ReactNode[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let listItems: React.ReactNode[] = [];
  let blockIdx = 0;
  let skip = false;

  function flushList() {
    if (listKind && listItems.length > 0) {
      if (listKind === 'ul') {
        blocks.push(
          <ul
            key={`b-${blockIdx++}`}
            className="mb-3 mt-1 space-y-1.5 text-[14px] leading-relaxed text-ink"
          >
            {listItems}
          </ul>,
        );
      } else {
        blocks.push(
          <ol
            key={`b-${blockIdx++}`}
            className="mb-3 mt-1 ml-1 list-decimal space-y-1.5 pl-4 text-[14px] leading-relaxed text-ink"
          >
            {listItems}
          </ol>,
        );
      }
      listItems = [];
    }
    listKind = null;
  }

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const trimmed = raw.trim();

    if (trimmed.startsWith('# ')) {
      const heading = trimmed.slice(2).trim();
      if (skipFromHeading && heading === skipFromHeading) {
        skip = true;
        continue;
      }
      if (skip) continue;
      flushList();
      blocks.push(
        <h2
          key={`b-${blockIdx++}`}
          className="mt-7 mb-2 text-[15.5px] font-extrabold tracking-tight text-ink sm:text-base"
        >
          {parseInline(heading, `h2-${li}`)}
        </h2>,
      );
      continue;
    }
    if (skip) continue;

    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push(
        <h3
          key={`b-${blockIdx++}`}
          className="mt-5 mb-1.5 text-[14px] font-bold text-ink"
        >
          {parseInline(trimmed.slice(3).trim(), `h3-${li}`)}
        </h3>,
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      blocks.push(
        <h4
          key={`b-${blockIdx++}`}
          className="mt-4 mb-1 text-[13px] font-bold text-ink"
        >
          {parseInline(trimmed.slice(4).trim(), `h4-${li}`)}
        </h4>,
      );
      continue;
    }

    if (trimmed === '---') {
      flushList();
      blocks.push(
        <hr key={`b-${blockIdx++}`} className="my-5 border-t border-line/15" />,
      );
      continue;
    }

    if (trimmed.startsWith('* ')) {
      if (listKind && listKind !== 'ul') flushList();
      listKind = 'ul';
      listItems.push(
        <li
          key={`li-${li}`}
          className="relative pl-4 before:absolute before:left-1 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-accent"
        >
          {parseInline(trimmed.slice(2), `li-${li}`)}
        </li>,
      );
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (olMatch) {
      if (listKind && listKind !== 'ol') flushList();
      listKind = 'ol';
      listItems.push(
        <li key={`li-${li}`} className="pl-1">
          {parseInline(olMatch[2], `li-${li}`)}
        </li>,
      );
      continue;
    }

    if (trimmed === '') {
      flushList();
      continue;
    }

    // 들여쓰기된 줄 (예: "   * 하위 불릿") — 가장 단순 처리: 한 단계 들여진 ul item 으로 처리
    const subBullet = raw.match(/^\s{2,}\*\s+(.+)/);
    if (subBullet) {
      if (listKind && listKind !== 'ul') flushList();
      listKind = 'ul';
      listItems.push(
        <li
          key={`li-${li}`}
          className="relative ml-5 pl-4 before:absolute before:left-1 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-ink-mute"
        >
          {parseInline(subBullet[1], `li-${li}`)}
        </li>,
      );
      continue;
    }

    flushList();
    blocks.push(
      <p
        key={`b-${blockIdx++}`}
        className="my-2 text-[14px] leading-relaxed text-ink"
      >
        {parseInline(trimmed, `p-${li}`)}
      </p>,
    );
  }
  flushList();

  return <div className={className}>{blocks}</div>;
}

/**
 * 본문에서 "## 계약 핵심 요약" 섹션을 추출 + 본문에서 제거.
 * 추가로: 본문 최상단의 페이지 제목 H1 ("# 음원 스트리밍 및 정산 이용 계약서 (v1)") 도 제거.
 * 페이지 wrapper 의 <h2 contract_title> 와 중복되지 않게 하기 위함.
 */
export function splitSummary(body: string): { summary: string | null; main: string } {
  const headingPattern = /^##\s*계약 핵심 요약\s*$/m;
  const startMatch = body.match(headingPattern);
  let main = body;
  let summary: string | null = null;
  if (startMatch && startMatch.index != null) {
    const headingStart = startMatch.index;
    const after = headingStart + startMatch[0].length;
    const hrIdx = body.indexOf('\n---', after);
    const nextH1 = body.slice(after).search(/\n#\s/);
    const endCandidates = [hrIdx, nextH1 >= 0 ? after + nextH1 : -1].filter((n) => n > 0);
    const endIdx = endCandidates.length ? Math.min(...endCandidates) : body.length;
    summary = body.slice(after, endIdx).trim();
    const cutEnd = endIdx + (body.slice(endIdx).match(/^\n---\n/) ? 4 : 0);
    main = body.slice(0, headingStart) + body.slice(cutEnd);
  }
  // 최상단 H1 (페이지 제목) 제거 — section <h2> 와 중복
  main = main.replace(/^\s*#\s+.+\n+/, '');
  // 첫 --- 구분선이 남으면 같이 제거 (시각 정돈)
  main = main.replace(/^\s*---\s*\n+/, '');
  return { summary, main: main.trim() };
}
