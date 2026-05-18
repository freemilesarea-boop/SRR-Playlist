import LegalPageLayout, { LegalSection, LegalList } from '@/components/common/LegalPageLayout';

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="이용약관"
      subtitle="듣다(deudda) 서비스 이용에 관한 약관입니다."
      updatedAt="2026-05-14"
    >
      <LegalSection title="제1조 (목적)">
        <p>
          본 약관은 루베르 콘텐츠 스튜디오(이하 “회사”)가 제공하는 듣다(deudda, 이하
          “서비스”)의 이용 조건과 절차, 회사와 회원의 권리·의무 및 책임 사항을 규정함을 목적으로
          합니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 (회원 유형)">
        <LegalList
          items={[
            '일반 회원: 음악 감상, 보관함, 큐레이션 사용',
            '사업자 회원: 매장 BGM, 자동 스케줄러, 사업자 검증 필요',
            '아티스트 회원: 본인 음원 등록 가능. 관리자 승인 후 활성화',
          ]}
        />
      </LegalSection>

      <LegalSection title="제3조 (정기결제 이용 조건)">
        <LegalList
          items={[
            '결제 수단: PayApp 정기결제(rebill) 모듈 사용',
            '요금제: 듣다 정기이용권(월 4,900원) / 듣다 사업자 정기이용권(월 6,900원)',
            '결제 주기: 매월 자동 청구',
            '결제 영수증/세금계산서: PayApp 가맹점 정보 기반 발행',
            '결제 실패 시 회사는 자동으로 다음 사이클에 재시도하거나 권한을 일시 정지할 수 있습니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="제4조 (해지 및 환불 정책)">
        <LegalList
          items={[
            '해지: 마이페이지 → 구독 관리 → 해지 버튼으로 즉시 처리',
            '해지 즉시 이용권이 종료되며 무료 플랜으로 자동 다운그레이드됩니다.',
            '남은 기간에 대한 환불은 자동 처리되지 않으며, 고객센터(freemilesarea@gmail.com) 로 별도 문의 시 검토 후 처리됩니다.',
            '카드사 승인 취소 / 부정 결제 발견 시 회사는 즉시 권한을 회수할 수 있습니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="제5조 (아티스트 음원 업로드 및 검수 정책)">
        <LegalList
          items={[
            '아티스트 회원은 가입 후 관리자 승인을 받아야 음원 업로드 권한이 부여됩니다.',
            '업로드된 음원은 visibility_status="pending_review" 상태로 저장되며 관리자 검수 후 공개됩니다.',
            '회사는 저작권 침해, 음란/혐오 콘텐츠, 형식 부적합 등의 사유로 거절(rejected) 또는 숨김(hidden) 처리할 수 있습니다.',
            '아티스트는 본인이 권리를 보유하거나 사용 허가를 받은 음원만 업로드해야 합니다.',
            '업로드한 음원의 저작권은 아티스트에게 있으며, 회사는 서비스 운영을 위한 비독점 사용권만 보유합니다.',
            '거절/숨김 처리에 이의가 있을 경우 고객센터로 재심사 요청이 가능합니다.',
          ]}
        />
      </LegalSection>

      <LegalSection title="제6조 (서비스 이용 제한)">
        <p>회사는 다음의 경우 회원의 서비스 이용을 제한 또는 종료할 수 있습니다.</p>
        <LegalList
          items={[
            '타인의 정보를 도용하거나 허위 정보로 가입한 경우',
            '저작권/지적재산권을 침해하는 콘텐츠를 업로드/공유한 경우',
            '결제 수단 부정 사용 또는 환불 악용이 의심되는 경우',
            '서비스의 정상 운영을 방해하는 행위 (스크래핑, 자동화 봇 등)',
            '관계 법령 또는 본 약관을 위반한 경우',
          ]}
        />
      </LegalSection>

      <LegalSection title="제7조 (책임의 제한)">
        <p>
          회사는 천재지변, 통신장애, 외부 서비스(예: PayApp, Supabase)의 장애 등 불가항력으로 인한
          서비스 중단에 대해 책임지지 않습니다. 회사가 제공하는 콘텐츠/추천 결과는 정보 제공
          목적이며, 이를 기반으로 한 사용자의 의사결정에 대한 책임은 사용자에게 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제8조 (약관의 변경)">
        <p>
          본 약관은 관계 법령 또는 서비스 정책 변화에 따라 개정될 수 있으며, 변경 시 서비스 내 공지
          또는 이메일로 안내합니다. 변경된 약관에 동의하지 않는 회원은 서비스 이용을 중단하고 탈퇴할
          수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제9조 (문의)">
        <p>
          서비스 이용 관련 문의는 <a href="mailto:freemilesarea@gmail.com" className="text-stone-900 underline">freemilesarea@gmail.com</a> 으로 연락 부탁드립니다.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
