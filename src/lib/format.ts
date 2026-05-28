export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 시간대 3-슬롯 — 매장 schedules 모델과 일치.
 * 0215 마이그 후 'night' 는 'evening' 으로 흡수, 'late'/'lunch' 도 정규화 완료.
 * 이 함수는 플리 분류용. 시각 테마(timeTheme.ts) 의 5-slot 은 별개로 유지.
 */
export type TimeSlot3 = 'morning' | 'afternoon' | 'evening';

export function currentTimeSlot(): TimeSlot3 {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  return 'evening'; // 21시 이후 'night' 도 evening 으로 흡수 (매장 마감대로 통합)
}

export function timeSlotLabel(slot: TimeSlot3 | string | null | undefined): string {
  switch (slot) {
    case 'morning':
      return '오전';
    case 'afternoon':
      return '오후';
    case 'evening':
      return '저녁';
    default:
      // 0215 이전 legacy 값이 어딘가 남아있을 때 호환 처리
      if (slot === 'night' || slot === 'late') return '저녁';
      if (slot === 'lunch') return '오후';
      return '';
  }
}
