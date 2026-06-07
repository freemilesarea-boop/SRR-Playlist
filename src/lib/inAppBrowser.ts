/**
 * inAppBrowser.ts — 인앱 (in-app) 브라우저 감지 (X6.26)
 *
 * 배경:
 *   카카오톡, 인스타그램, 페이스북, 네이버앱, 라인, 다음앱 등 모바일
 *   인앱 브라우저는 보안 정책상 Google OAuth 를 자주 차단함
 *   ("액세스 차단됨: 듣다의 요청이 Google 정책을 준수하지 않습니다").
 *   삼성인터넷은 정식 브라우저지만 일부 안드로이드 환경에서 동일 문제 보고됨.
 *
 *   사용자에게는 이 시점에 외부 Chrome / Safari 로 열도록 안내해야 함.
 *
 * 식별 시그니처 (User-Agent 기반):
 *   - KakaoTalk:        "KAKAOTALK"
 *   - Instagram:        "Instagram"
 *   - Facebook:         "FBAN", "FBAV", "FB_IAB"
 *   - Naver (앱):       "NAVER(inapp;" 또는 "naver" + inapp/whale
 *   - Line:             "Line/"
 *   - Daum:             "Daum/"  (다음 앱 인앱)
 *   - Samsung Internet: "SamsungBrowser"
 *
 *   대소문자 혼재 케이스가 있어 정규식은 case-insensitive.
 *
 * 안전:
 *   - 서버사이드 / Node 환경에서 navigator 가 없을 수 있어 typeof 가드.
 *   - 잘못된 false positive 방지 위해 화이트리스트 방식.
 */
export type InAppBrowserName =
  | 'kakaotalk'
  | 'instagram'
  | 'facebook'
  | 'naver'
  | 'line'
  | 'daum'
  | 'samsung';

const PATTERNS: Array<{ name: InAppBrowserName; regex: RegExp; label: string }> = [
  { name: 'kakaotalk', regex: /kakaotalk/i,           label: '카카오톡' },
  { name: 'instagram', regex: /instagram/i,            label: 'Instagram' },
  { name: 'facebook',  regex: /\bFB(AN|AV|_IAB)\b/i,   label: 'Facebook' },
  { name: 'naver',     regex: /NAVER\(inapp/i,         label: '네이버 앱' },
  { name: 'line',      regex: /\bLine\//i,             label: 'LINE' },
  { name: 'daum',      regex: /\bDaum\//i,             label: '다음 앱' },
  { name: 'samsung',   regex: /SamsungBrowser/i,       label: '삼성 인터넷' },
];

export interface InAppDetection {
  isInApp: boolean;
  name: InAppBrowserName | null;
  label: string | null;
  /** 진단/Sentry 첨부용. 민감 정보 없음. */
  userAgent: string;
}

export function detectInAppBrowser(): InAppDetection {
  if (typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string') {
    return { isInApp: false, name: null, label: null, userAgent: '' };
  }
  const ua = navigator.userAgent;
  for (const p of PATTERNS) {
    if (p.regex.test(ua)) {
      return { isInApp: true, name: p.name, label: p.label, userAgent: ua };
    }
  }
  return { isInApp: false, name: null, label: null, userAgent: ua };
}

/** iOS Safari (정식) 인지 — 인앱 모달의 "Safari 에서 열기" 안내에 사용. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Android 인지 — Chrome 안내 분기용. */
export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}
