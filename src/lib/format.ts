export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function currentTimeSlot(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

export function timeSlotLabel(slot: 'morning' | 'afternoon' | 'evening' | 'night'): string {
  switch (slot) {
    case 'morning':
      return '오전';
    case 'afternoon':
      return '오후';
    case 'evening':
      return '저녁';
    case 'night':
      return '밤';
  }
}
