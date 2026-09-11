/**
 * companyInfo.ts — 사업자 정보 한 벌.
 *
 * 전자상거래법상 표시 의무가 있는 항목이라 웹 푸터와 앱 전체 메뉴가 같은 값을 써야 한다.
 * 두 군데에 따로 적어두면 한쪽만 바뀌어 어긋난다.
 */
export interface CompanyInfoRow {
  label: string;
  value: string;
}

export const COMPANY_INFO: CompanyInfoRow[] = [
  { label: '상호', value: '루베르 콘텐츠 스튜디오' },
  { label: '대표', value: '이승현' },
  { label: '사업자번호', value: '234-52-00922' },
  { label: '통신판매업', value: '2026-서울성동-0724 호' },
  { label: '주소', value: '서울특별시 성동구 왕십리로 326 세신빌딩 6층 614호' },
  { label: '이메일', value: 'freemilesarea@gmail.com' },
];
