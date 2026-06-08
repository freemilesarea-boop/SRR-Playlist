/**
 * inAppBrowser.ts — 인앱 (in-app) 브라우저 감지 (X6.26 / X6.32 확장)
 *
 * 배경:
 *   카카오톡, 인스타그램, 페이스북, 네이버앱, 라인, 다음앱 등 모바일
 *   인앱 브라우저는 보안 정책상 Google OAuth 를 자주 차단함
 *   ("403 disallowed_useragent — Google 정책을 준수하지 않습니다").
 *   삼성인터넷은 정식 브라우저지만 일부 안드로이드 환경에서 동일 문제 보고됨.
 *
 *   사용자에게는 이 시점에 외부 Chrome / Safari 로 열도록 안내해야 함.
 *
 * X6.32 확장:
 *   - 글로벌 인앱 5종 (WeChat, Telegram, Twitter, TikTok, Snapchat)
 *   - 국내 앱 5종 (쿠팡, 토스, 배민, 컬리, 당근)
 *   - Android WebView 일반 시그니처 (; wv) — 자체 앱이 시스템 WebView 임베드)
 *   - iOS WKWebView 휴리스틱 (Safari/ 토큰 없는 Mobile UA)
 *   화이트리스트 + 휴리스틱 조합 — false positive 최소화하면서 차단 누락 방지.
 *
 * 식별 시그니처 (User-Agent 기반):
 *   - KakaoTalk:        "KAKAOTALK"
 *   - Instagram:        "Instagram"
 *   - Facebook:         "FBAN", "FBAV", "FB_IAB"
 *   - Naver (앱):       "NAVER(inapp;"
 *   - Line:             "Line/"
 *   - Daum:             "Daum/"
 *   - Samsung Internet: "SamsungBrowser"
 *   - WeChat:           "MicroMessenger"
 *   - Telegram:         "TelegramBot"
 *   - Twitter/X:        "TwitterForIPhone" / "TwitterAndroid"
 *   - TikTok:           "musical_ly" / "Bytedance" / "TikTok"
 *   - Snapchat:         "Snapchat"
 *   - 쿠팡:             "Coupang"
 *   - 토스:             "Toss/" / "TossPay"
 *   - 배민:             "Baemin"
 *   - 컬리:             "Kurly"
 *   - 당근:             "Karrot"
 *   - Android WebView:  "; wv)"
 *   - iOS WKWebView:    iOS Mobile UA 인데 Safari/, Version/ 토큰 누락
 *
 * 안전:
 *   - 서버사이드 / Node 환경에서 navigator 가 없을 수 있어 typeof 가드.
 *   - 잘못된 false positive 방지 위해 화이트리스트 우선 매칭 후 휴리스틱.
 */
export type InAppBrowserName =
  | 'kakaotalk'
  | 'instagram'
  | 'facebook'
  | 'naver'
  | 'line'
  | 'daum'
  | 'samsung'
  | 'wechat'
  | 'telegram'
  | 'twitter'
  | 'tiktok'
  | 'snapchat'
  | 'coupang'
  | 'toss'
  | 'baemin'
  | 'kurly'
  | 'karrot'
  | 'android_webview'
  | 'ios_webview_heuristic';

const PATTERNS: Array<{ name: InAppBrowserName; regex: RegExp; label: string }> = [
  // ===== 메신저 / SNS (글로벌) =====
  { name: 'kakaotalk', regex: /kakaotalk/i,                             label: '카카오톡' },
  { name: 'instagram', regex: /instagram/i,                              label: 'Instagram' },
  { name: 'facebook',  regex: /\bFB(AN|AV|_IAB)\b/i,                     label: 'Facebook' },
  { name: 'naver',     regex: /NAVER\(inapp/i,                           label: '네이버 앱' },
  { name: 'line',      regex: /\bLine\//i,                               label: 'LINE' },
  { name: 'daum',      regex: /\bDaum\//i,                               label: '다음 앱' },
  { name: 'samsung',   regex: /SamsungBrowser/i,                         label: '삼성 인터넷' },
  { name: 'wechat',    regex: /MicroMessenger/i,                         label: 'WeChat (微信)' },
  { name: 'telegram',  regex: /TelegramBot/i,                            label: 'Telegram' },
  { name: 'twitter',   regex: /Twitter(For)?(iPhone|iPad|Android)/i,     label: 'X (Twitter)' },
  { name: 'tiktok',    regex: /(musical_ly|Bytedance|TikTok)/i,          label: 'TikTok' },
  { name: 'snapchat',  regex: /Snapchat/i,                               label: 'Snapchat' },
  // ===== 국내 서비스 앱 =====
  { name: 'coupang',   regex: /\bCoupang\b/i,                            label: '쿠팡' },
  { name: 'toss',      regex: /(TossPay|Toss\/[\d.]+)/i,                 label: '토스' },
  { name: 'baemin',    regex: /Baemin/i,                                 label: '배달의민족' },
  { name: 'kurly',     regex: /Kurly/i,                                  label: '컬리' },
  { name: 'karrot',    regex: /(Karrot|DaangnApp)/i,                     label: '당근' },
  // ===== 일반 WebView 시그니처 (catch-all) =====
  // Android: Chrome/X 와 함께 "; wv)" 마커가 있으면 시스템 WebView 임베드
  { name: 'android_webview', regex: /;\s*wv\)/i,                          label: 'Android 인앱 브라우저' },
];

export interface InAppDetection {
  isInApp: boolean;
  name: InAppBrowserName | null;
  label: string | null;
  /** 진단/Sentry 첨부용. 민감 정보 없음. */
  userAgent: string;
  /** X6.32: 매칭 방식 — 'whitelist' (이름 식별) / 'heuristic' (UA 휴리스틱) */
  matchedBy: 'whitelist' | 'heuristic' | null;
}

/**
 * iOS WKWebView 휴리스틱:
 *   정식 Safari 는 UA 에 "Version/X" 와 "Safari/X" 둘 다 있음.
 *   인앱 WKWebView 는 둘 다 없는 경우가 많음 (제3자 앱이 SFSafariViewController
 *   대신 WKWebView 를 직접 임베드한 경우).
 *   false positive 줄이려고 iOS Mobile UA 만 검사.
 */
function isLikelyIosWebView(ua: string): boolean {
  const isIosMobile = /\b(iPhone|iPad|iPod)\b/.test(ua) && /Mobile\//.test(ua);
  if (!isIosMobile) return false;
  const hasSafariToken = /Safari\//i.test(ua);
  const hasVersionToken = /Version\//i.test(ua);
  return !hasSafariToken && !hasVersionToken;
}

export function detectInAppBrowser(): InAppDetection {
  if (typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string') {
    return { isInApp: false, name: null, label: null, userAgent: '', matchedBy: null };
  }
  const ua = navigator.userAgent;
  // 1) 화이트리스트 우선 매칭 (정확한 앱 식별)
  for (const p of PATTERNS) {
    if (p.regex.test(ua)) {
      return { isInApp: true, name: p.name, label: p.label, userAgent: ua, matchedBy: 'whitelist' };
    }
  }
  // 2) 휴리스틱 폴백 (iOS WKWebView)
  if (isLikelyIosWebView(ua)) {
    return {
      isInApp: true,
      name: 'ios_webview_heuristic',
      label: '기타 인앱 브라우저 (iOS)',
      userAgent: ua,
      matchedBy: 'heuristic',
    };
  }
  return { isInApp: false, name: null, label: null, userAgent: ua, matchedBy: null };
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
