import { describe, it, expect } from 'vitest';
import { applyMarkdown, safeGuideHref } from './guideMarkdown';
import { groupGuidesByCategory, safeStorageName, formatFileSize } from './enterpriseGuideApi';

describe('safeGuideHref — 본문 링크', () => {
  it('http(s)·mailto·내부 경로·앵커만 살린다', () => {
    expect(safeGuideHref('https://deudda.com')).toBe('https://deudda.com');
    expect(safeGuideHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeGuideHref('/service')).toBe('/service');
    expect(safeGuideHref('#step-1')).toBe('#step-1');
  });
  it('javascript:·data:·프로토콜 상대 주소는 버린다', () => {
    expect(safeGuideHref('javascript:alert(1)')).toBeNull();
    expect(safeGuideHref(' JavaScript:alert(1)')).toBeNull();
    expect(safeGuideHref('data:text/html,x')).toBeNull();
    expect(safeGuideHref('//evil.com')).toBeNull();
    expect(safeGuideHref(undefined)).toBeNull();
  });
});

describe('applyMarkdown — 편집 도구', () => {
  it('굵게: 선택을 감싸고, 없으면 예시 글자', () => {
    expect(applyMarkdown('abc def', 4, 7, 'bold').text).toBe('abc **def**');
    expect(applyMarkdown('', 0, 0, 'bold').text).toBe('**굵은 글씨**');
  });
  it('소제목·목록: 커서가 있는 줄 앞에 붙이고, 이미 있으면 그대로', () => {
    expect(applyMarkdown('첫 줄\n둘째 줄', 6, 6, 'h2').text).toBe('첫 줄\n## 둘째 줄');
    expect(applyMarkdown('## 이미', 3, 3, 'h2').text).toBe('## 이미');
    expect(applyMarkdown('가\n나', 0, 3, 'list').text).toBe('- 가\n- 나');
    expect(applyMarkdown('## 제목', 0, 0, 'list').text).toBe('- 제목');
  });
  it('링크: 커서를 주소 자리에 둔다', () => {
    const r = applyMarkdown('여기', 0, 2, 'link');
    expect(r.text).toBe('[여기](https://)');
    expect(r.text.slice(0, r.cursor)).toBe('[여기](https://');
  });
  it('이미지 넣기: 앞 문단과 빈 줄로 띄운다', () => {
    expect(applyMarkdown('문단', 2, 2, 'insert', '![a](u)').text).toBe('문단\n\n![a](u)\n\n');
    expect(applyMarkdown('', 0, 0, 'insert', '![a](u)').text).toBe('![a](u)\n\n');
  });
});

describe('enterpriseGuideApi 도우미', () => {
  it('카테고리별로 묶되 서버 순서를 지킨다', () => {
    const g = groupGuidesByCategory([
      { id: 1, category: '시작하기' }, { id: 2, category: '운영' }, { id: 3, category: '시작하기' }, { id: 4, category: '' },
    ]);
    expect(g.map((x) => [x.category, x.items.map((i) => i.id)])).toEqual([
      ['시작하기', [1, 3]], ['운영', [2]], ['일반', [4]],
    ]);
  });
  it('저장 경로용 파일 이름 — 한글·공백·특수문자 제거, 확장자 유지', () => {
    expect(safeStorageName('듣다 소개서 v2.PDF')).toBe('v2.pdf');
    expect(safeStorageName('Getting Started!.png')).toBe('getting-started.png');
    expect(safeStorageName('설명서.pdf')).toBe('file.pdf');
  });
  it('파일 크기 표시', () => {
    expect(formatFileSize(500)).toBe('1KB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5MB');
    expect(formatFileSize(null)).toBe('');
  });
});
