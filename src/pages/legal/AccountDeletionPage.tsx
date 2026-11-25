import LegalPageLayout, { LegalSection, LegalList } from '@/components/common/LegalPageLayout';

/**
 * 계정 삭제 안내 — 구글 플레이 '데이터 삭제' 선언에 등록하는 공개 URL.
 *
 * 플레이 요구사항 세 가지를 이 페이지 하나가 전부 충족해야 한다:
 *   1. 스토어 등록정보에 표시되는 앱 이름과 개발자 이름을 적을 것
 *   2. 삭제를 요청하는 단계를 눈에 띄게 보여줄 것
 *   3. 삭제되는 데이터와 계속 보관되는 데이터를 기간과 함께 밝힐 것
 *
 * **로그인 없이 열려야 한다.** App.tsx 의 공개 라우트 구역에 둔 이유다.
 * 보관 기간은 PrivacyPage 4항과 같은 값이어야 한다 — 한쪽만 고치면 안 된다
 * (accountDeletion.test.ts 가 두 파일을 대조한다).
 */
export default function AccountDeletionPage() {
  return (
    <LegalPageLayout
      title="계정 및 데이터 삭제 요청"
      subtitle="듣다(Deudda) — 루베르 콘텐츠 스튜디오"
      updatedAt="2026-09-15"
    >
      <LegalSection title="앱에서 직접 탈퇴하기">
        <p>앱이나 웹에서 아래 순서로 진행하면 별도 요청 없이 바로 처리됩니다.</p>
        <LegalList
          items={[
            '앱 실행 후 로그인합니다.',
            '하단 메뉴에서 "더보기" → "프로필"(또는 마이페이지)로 이동합니다.',
            '화면 아래쪽 "회원 탈퇴"를 누릅니다.',
            '안내 문구를 확인하고 "탈퇴하기"를 누르면 즉시 처리됩니다.',
          ]}
        />
        <p className="mt-2">
          이용 중인 유료 구독이 있으면 먼저 구독을 해지하고 결제 기간이 끝난 뒤에 탈퇴할 수
          있습니다. 결제가 진행 중인 상태에서 계정이 사라지면 환불·정산을 처리할 수 없기
          때문입니다.
        </p>
      </LegalSection>

      <LegalSection title="이메일로 요청하기">
        <p>
          앱에 접속할 수 없는 경우{' '}
          <a href="mailto:freemilesarea@gmail.com?subject=계정 삭제 요청" className="text-stone-900 underline">
            freemilesarea@gmail.com
          </a>{' '}
          으로 가입하신 이메일 주소와 함께 삭제를 요청해 주세요. 본인 확인 후 지체 없이
          처리하고 결과를 회신드립니다.
        </p>
      </LegalSection>

      <LegalSection title="삭제되는 데이터">
        <p>탈퇴하면 아래 정보가 파기되어 더 이상 서비스에서 이용되지 않습니다.</p>
        <LegalList
          items={[
            '계정 정보 — 이름, 생년월일, 이메일, 전화번호, 주소',
            '사업자 회원 정보 — 사업자등록번호, 상호명, 대표자명, 개업일자',
            '매장 설정 — 매장 프로필, 시간대별 재생 스케줄',
            '이용 기록 — 재생 이력, 검색 기록, 좋아요, 보관함, 내 플레이리스트',
            '알림용 기기 식별자 — 푸시 토큰',
            '아티스트 회원의 업로드 음원 파일 및 커버 이미지',
            '본인확인 결과(CI/DI) — 탈퇴 시 즉시 파기',
          ]}
        />
      </LegalSection>

      <LegalSection title="법령에 따라 계속 보관되는 데이터">
        <p>
          아래 항목은 관계 법령이 보관을 의무화하고 있어 탈퇴 후에도 정해진 기간 동안
          분리 보관되며, 기간이 지나면 복구할 수 없는 방식으로 파기됩니다. 이 기간에도
          해당 기록은 법령이 정한 목적 외에는 이용되지 않습니다.
        </p>
        <LegalList
          items={[
            '결제 기록 / 청약철회 등 거래 기록: 5년 (전자상거래법)',
            '소비자 불만 / 분쟁 처리 기록: 3년 (전자상거래법)',
            '로그인 기록 / 접속 로그: 3개월 (통신비밀보호법)',
          ]}
        />
      </LegalSection>

      <LegalSection title="문의">
        <LegalList
          items={[
            '앱 이름: 듣다 (Deudda)',
            '개발자: 루베르 콘텐츠 스튜디오',
            '개인정보 보호 책임자: 이승현 (대표)',
            '이메일: freemilesarea@gmail.com',
            '주소: 서울특별시 성동구 왕십리로 326 세신빌딩 6층 614호',
          ]}
        />
      </LegalSection>
    </LegalPageLayout>
  );
}
