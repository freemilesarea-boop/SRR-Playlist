/**
 * titleRules — 곡 제목 자동 검사 (검수 직원이 반복해서 거절하던 제목 규칙).
 *
 * 근거: 운영 검수 기록(2026-06~11) 중 '파일명/제목 오류' 거절 사유를 분류한 결과.
 *   · 순번      — "07 Almost Gone", "10.Quietly Yours", "01바람이 스치는 언덕"
 *   · 언어 중복 — "월광단 月光丹", "Petrichor (雨の匂い)", "Tonight (투나잇)오늘밤"
 *                 (곡 제목은 영어·일본어·한국어 중 하나만, 발음·해석 병기 금지)
 *   · 작업 메타 — "On Read master balanced 14LUFS", "Cold Between Us … preview"
 * 9월 이후 언어 중복으로 거절된 123곡 중 120곡을 잡고, 같은 기간 통과곡 993곡 중 32곡(3%)이
 * 걸린다 — 그래서 막지 않고 '경고'로만 보여준다(최종 판단은 검수 직원).
 */

export type TitleIssueCode = 'track_number' | 'mixed_language' | 'hangul_hanja' | 'work_metadata' | 'file_extension';

export interface TitleIssue {
  code: TitleIssueCode;
  /** 업로더에게 보여줄 문장 */
  message: string;
}

export interface TitleCheckResult {
  issues: TitleIssue[];
  /** 순번·작업 메타·확장자를 걷어낸 제안 제목(언어 중복은 사람이 골라야 해서 그대로 둔다). */
  suggestion: string | null;
}

const HANGUL = /[가-힣]/;
const LATIN_WORD = /[A-Za-z]{2,}/;
const KANA = /[ぁ-んァ-ヶ]/;
const HAN = /[一-龥]/;

// 앞쪽 순번: 0으로 시작하는 두 자리, 숫자+구두점(. - _ )), 숫자에 바로 붙은 한글·일본어.
const TRACK_NUMBER = /^\s*(?:0\d\s*[.\-_)]?\s*|\d{1,3}\s*[.\-_)]\s*|\d{1,3}(?=[가-힣ぁ-んァ-ヶ一-龥]))/;

// 작업 파일에 붙는 말(마스터링·믹스·라우드니스·미리듣기 등).
const WORK_META = /(\bmaster(?:ed)?\b|\bmixdown\b|\bmix\s*v?\d+\b|-?\d+(?:\.\d+)?\s*lufs\b|\blufs\b|\bpreview\b|\bdemo\b|\bfinal\b|\d+\s*bpm\b|\bbpm\b|\bver\.?\s*\d+\b|\bv\d+\b|\brough\b|\bstems?\b|\d+\s*kbps\b|\d+(?:\.\d+)?\s*khz\b|\buntitled\b|\bkpop\s+loud\b|\b(?:balanced|natural|bright|loud)\b(?=\s*(?:-?\d+\s*lufs|preview|$)))/gi;

const FILE_EXT = /\.(?:wav|mp3|flac|aiff?|m4a|ogg)\s*$/i;

export function checkTrackTitle(raw: string): TitleCheckResult {
  const title = (raw ?? '').trim();
  const issues: TitleIssue[] = [];
  if (!title) return { issues, suggestion: null };

  if (TRACK_NUMBER.test(title)) {
    issues.push({ code: 'track_number', message: '제목 앞의 순번(01, 1. 등)을 빼 주세요.' });
  }
  if (FILE_EXT.test(title)) {
    issues.push({ code: 'file_extension', message: '제목에 파일 확장자(.wav 등)가 들어 있어요.' });
  }
  const meta = title.match(WORK_META);
  if (meta && meta.length > 0) {
    const words = [...new Set(meta.map((m) => m.trim()))].slice(0, 3).join(', ');
    issues.push({ code: 'work_metadata', message: `작업용 표기(${words})를 빼고 곡 제목만 적어 주세요.` });
  }

  // 일본어는 가나·한자를 섞어 쓰므로 한 언어로 본다. 한글+한자(가나 없음)는 따로 잡는다.
  const japanese = KANA.test(title) || (HAN.test(title) && !HANGUL.test(title));
  const groups = Number(HANGUL.test(title)) + Number(LATIN_WORD.test(title.replace(WORK_META, ''))) + Number(japanese);
  if (HANGUL.test(title) && HAN.test(title) && !KANA.test(title)) {
    issues.push({ code: 'hangul_hanja', message: '한글과 한자를 함께 쓰지 말고 하나만 적어 주세요. (예: "월광단 月光丹" → "월광단")' });
  } else if (groups >= 2) {
    issues.push({ code: 'mixed_language', message: '제목은 영어·일본어·한국어 중 하나로만 적어 주세요. 발음이나 해석을 괄호로 함께 적지 마세요.' });
  }

  let suggestion: string | null = title
    .replace(TRACK_NUMBER, '')
    .replace(FILE_EXT, '')
    .replace(WORK_META, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-_.]+$/, '')
    .trim();
  if (!suggestion || suggestion === title) suggestion = null;

  return { issues, suggestion };
}

/** 검수 화면 배지용 짧은 이름. */
export const TITLE_ISSUE_SHORT: Record<TitleIssueCode, string> = {
  track_number: '순번',
  mixed_language: '언어 중복',
  hangul_hanja: '한글·한자',
  work_metadata: '작업 표기',
  file_extension: '확장자',
};
