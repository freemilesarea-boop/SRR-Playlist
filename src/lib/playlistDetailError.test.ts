import { describe, it, expect } from 'vitest';
import { playlistDetailErrorMessage } from './playlistDetailError';

describe('playlistDetailErrorMessage — 서버 원문이 화면에 나오지 않는다', () => {
  it('권한 오류는 로그인 안내로', () => {
    const m = playlistDetailErrorMessage({ message: 'permission denied for function get_user_playlist_detail' });
    expect(m).toBe('로그인 후 볼 수 있어요.');
    expect(m).not.toMatch(/permission|function/);
  });
  it('비공개는 비공개 안내로', () => {
    expect(playlistDetailErrorMessage(new Error('forbidden'))).toContain('비공개');
  });
  it('그 밖의 오류는 일반 문구로', () => {
    const m = playlistDetailErrorMessage(new Error('relation "x" does not exist'));
    expect(m).not.toContain('relation');
    expect(m).toContain('다시 시도');
  });
});
