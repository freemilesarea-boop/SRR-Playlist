import { describe, it, expect } from 'vitest';
import {
  buildBroadcastSubject,
  isMarketing,
  validateBroadcastDraft,
  summarizeSend,
  EMAIL_KIND_LABEL,
  RECIPIENT_MODE_LABEL,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  type ComposeDraft,
} from './broadcastEmail';

describe('buildBroadcastSubject', () => {
  it('prefixes [광고] for ad emails', () => {
    expect(buildBroadcastSubject('여름 할인', 'ad')).toBe('[광고] 여름 할인');
  });
  it('does not prefix notice emails', () => {
    expect(buildBroadcastSubject('점검 안내', 'notice')).toBe('점검 안내');
  });
  it('does not double-prefix when [광고] already present', () => {
    expect(buildBroadcastSubject('[광고] 여름 할인', 'ad')).toBe('[광고] 여름 할인');
    expect(buildBroadcastSubject('  [광고] 세일', 'ad')).toBe('[광고] 세일');
  });
  it('trims whitespace', () => {
    expect(buildBroadcastSubject('  공지  ', 'notice')).toBe('공지');
  });
});

describe('isMarketing', () => {
  it('true only for ad', () => {
    expect(isMarketing('ad')).toBe(true);
    expect(isMarketing('notice')).toBe(false);
  });
});

describe('validateBroadcastDraft', () => {
  const base: ComposeDraft = {
    subject: '제목', bodyHtml: '<p>본문</p>', kind: 'notice', mode: 'all', selectedCount: 0, scheduledAt: null,
  };
  it('passes a valid draft', () => {
    expect(validateBroadcastDraft(base).ok).toBe(true);
  });
  it('requires subject', () => {
    const r = validateBroadcastDraft({ ...base, subject: '  ' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('제목');
  });
  it('requires body', () => {
    const r = validateBroadcastDraft({ ...base, bodyHtml: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('본문');
  });
  it('requires at least one recipient in selected mode', () => {
    const r = validateBroadcastDraft({ ...base, mode: 'selected', selectedCount: 0 });
    expect(r.ok).toBe(false);
  });
  it('accepts selected mode with recipients', () => {
    expect(validateBroadcastDraft({ ...base, mode: 'selected', selectedCount: 3 }).ok).toBe(true);
  });
  it('rejects a past scheduled time', () => {
    const now = 1_000_000;
    const past = new Date(now - 60_000).toISOString();
    const r = validateBroadcastDraft({ ...base, scheduledAt: past }, now);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('이후');
  });
  it('accepts a future scheduled time', () => {
    const now = 1_000_000;
    const future = new Date(now + 3_600_000).toISOString();
    expect(validateBroadcastDraft({ ...base, scheduledAt: future }, now).ok).toBe(true);
  });
  it('rejects an overly long subject', () => {
    const r = validateBroadcastDraft({ ...base, subject: 'x'.repeat(201) });
    expect(r.ok).toBe(false);
  });
});

describe('summarizeSend', () => {
  it('describes an immediate send', () => {
    const s = summarizeSend({ kind: 'notice', mode: 'all', scheduledAt: null }, 1234);
    expect(s).toContain('공지성');
    expect(s).toContain('전체 회원');
    expect(s).toContain('1,234');
    expect(s).toContain('지금');
  });
  it('describes a scheduled ad send', () => {
    const s = summarizeSend({ kind: 'ad', mode: 'filter', scheduledAt: '2030-01-01T00:00:00.000Z' }, 10);
    expect(s).toContain('광고성');
    expect(s).toContain('예약');
  });
});

describe('label/tone maps are complete', () => {
  it('has labels for every kind and mode', () => {
    expect(EMAIL_KIND_LABEL.notice).toBeTruthy();
    expect(EMAIL_KIND_LABEL.ad).toBeTruthy();
    expect(RECIPIENT_MODE_LABEL.all).toBeTruthy();
    expect(RECIPIENT_MODE_LABEL.filter).toBeTruthy();
    expect(RECIPIENT_MODE_LABEL.selected).toBeTruthy();
  });
  it('has a label and tone for every status', () => {
    const statuses = ['draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled'] as const;
    for (const s of statuses) {
      expect(CAMPAIGN_STATUS_LABEL[s]).toBeTruthy();
      expect(CAMPAIGN_STATUS_TONE[s]).toBeTruthy();
    }
  });
});
