/**
 * iosAudio.ts — iOS/iPadOS 에서 볼륨 슬라이더가 통하지 않는다는 사실 하나를 다룬다.
 *
 * WebKit 은 audio.volume setter 를 무시한다(Apple 정책). 그래서 슬라이더를 아무리 움직여도
 * 소리가 그대로다. 고칠 수 있는 문제가 아니라서, 슬라이더를 숨기는 대신 "기기 볼륨 버튼을
 * 쓰라" 고 알려주는 편이 낫다 — 매장에서는 아무 반응 없는 조작부가 고장으로 읽힌다.
 *
 * Player.tsx 안에 사적으로 있던 것을 꺼냈다. 매장 플레이어에도 같은 판정이 필요한데
 * 복사해두면 한쪽만 고쳐지기 때문이다.
 */

/** ± 버튼 한 번에 움직이는 폭. 10%면 0↔100 을 열 번에 오간다 — 매장에서 그 정도가 적당하다. */
export const VOLUME_STEP = 0.1;

/**
 * 볼륨을 한 칸 올리거나 내린 값. 0~1 밖으로 나가지 않는다.
 *
 * 소수 둘째 자리에서 끊는 이유: 0.7 - 0.1 이 0.5999999999999999 가 되는 탓에
 * 화면의 퍼센트가 60 과 59 를 오가고, 슬라이더 value 도 어긋난다.
 */
export function nudgeVolume(current: number, delta: number): number {
  const next = Math.round((current + delta) * 100) / 100;
  return Math.min(1, Math.max(0, next));
}

/** 이 기기에서 audio.volume 설정이 무시되는가(= 앱 안의 볼륨 조절이 안 먹는가). */
export function isIOSVolumeLocked(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 는 navigator.platform 을 'MacIntel' 로 위장한다.
  // 터치 포인트가 있으면 맥이 아니라 아이패드로 본다.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}
