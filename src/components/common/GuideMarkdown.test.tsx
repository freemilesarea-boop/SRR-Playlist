// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideMarkdown from './GuideMarkdown';

afterEach(() => cleanup());

function renderMd(src: string) {
  return render(<MemoryRouter><GuideMarkdown source={src} /></MemoryRouter>).container;
}

describe('GuideMarkdown — 가이드 본문 표시', () => {
  it('소제목·목록·굵게·표를 그린다', () => {
    const c = renderMd('## 1단계\n\n- **계약**\n- 매장 연결\n\n| 항목 | 값 |\n|---|---|\n| 매장 | 10 |');
    expect(c.querySelector('h2')?.textContent).toBe('1단계');
    expect(c.querySelectorAll('li')).toHaveLength(2);
    expect(c.querySelector('strong')?.textContent).toBe('계약');
    expect(c.querySelector('table td')?.textContent).toBe('매장');
  });

  it('원문 HTML 은 그리지 않는다 — <script>·<img onerror> 가 요소로 생기지 않는다', () => {
    const c = renderMd('안녕\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
  });

  it('javascript: 링크는 글자로만 남기고, 외부 링크는 새 창, 내부 경로는 사이트 안 이동', () => {
    const c = renderMd('[나쁜](javascript:alert(1)) [밖](https://example.com) [안](/service)');
    const links = Array.from(c.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['밖', '안']);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(links[1].getAttribute('href')).toBe('/service');
    expect(c.textContent).toContain('나쁜');
  });

  it('이미지는 https 주소만', () => {
    const c = renderMd('![a](https://x.supabase.co/a.png)\n\n![b](http://evil.com/b.png)');
    const imgs = c.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('https://x.supabase.co/a.png');
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
  });
});
