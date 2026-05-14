import LegalPageLayout, { LegalSection, LegalList } from '@/components/common/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="개인정보 처리방침"
      subtitle="루베르 콘텐츠 스튜디오는 회원의 개인정보를 다음과 같이 안전하게 처리합니다."
      updatedAt="2026-05-14"
    >
      <LegalSection title="1. 수집하는 개인정보 항목">
        <p>회사는 회원가입, 결제, 서비스 제공을 위해 다음 항목을 수집합니다.</p>
        <p className="mt-2 font-semibold text-stone-800">[모든 회원 공통]</p>
        <LegalList
          items={[
            '이름 / 생년월일',
            '전화번호 / 주소',
            '이메일 (로그인 ID)',
            '회원 유형 (일반 / 사업자 / 아티스트)',
            '결제 정보 (PayApp 위탁 처리 — 카드번호 직접 보관 X)',
            '서비스 이용 기록 (재생 이력, 검색 기록, 디바이스 정보)',
          ]}
        />

        <p className="mt-4 font-semibold text-stone-800">[사업자 회원 추가]</p>
        <LegalList
          items={[
            '사업자등록번호 / 상호명 / 대표자명 / 개업일자',
            '매장명 / 매장 주소 / 업종',
            '사업자 검증 결과 (verified / pending / rejected)',
          ]}
        />

        <p className="mt-4 font-semibold text-stone-800">[아티스트 회원 추가]</p>
        <LegalList
          items={[
            '아티스트명 (활동명)',
            '업로드한 음원 파일 / 커버 이미지',
            '음원 메타데이터 (제목 / 장르 / 분위기 / 가사 등)',
            '심사 상태 (pending_review / approved / rejected / hidden)',
          ]}
        />

        <p className="mt-4 font-semibold text-stone-800">[수집하지 않는 항목]</p>
        <LegalList
          items={[
            '주민등록번호 원문 또는 뒷자리',
            '신분증 사본 이미지',
            '카드번호 / CVC / 비밀번호 (PayApp 가 직접 처리)',
          ]}
        />
      </LegalSection>

      <LegalSection title="2. 본인 확인 (CI/DI)">
        <p>
          본인 확인이 필요한 경우 NICE / KCB / 토스 / 카카오 등 외부 본인확인기관을 통해 처리하며,
          회사는 외부 인증기관이 발급한 <strong>CI(연계정보) / DI(중복가입확인정보)</strong> 만
          저장합니다. 주민등록번호 원문은 어떠한 경우에도 저장하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="3. 개인정보 처리 위탁">
        <LegalList
          items={[
            <>
              <strong>결제 처리:</strong> PayApp (정기결제 등록 · 청구 · 영수증 · 환불 처리)
            </>,
            <>
              <strong>인프라:</strong> Supabase (데이터베이스 / 인증 / 스토리지)
            </>,
            <>
              <strong>호스팅:</strong> Vercel (프론트엔드 배포)
            </>,
            <>
              <strong>오디오 변환:</strong> ffmpeg.wasm (사용자 브라우저에서 로컬 처리)
            </>,
          ]}
        />
        <p className="mt-2">
          위탁 업체는 회사의 처리 지침에 따라 정보를 처리하며, 위탁 종료 시 보유 정보는 즉시 파기됩니다.
        </p>
      </LegalSection>

      <LegalSection title="4. 개인정보 보유 및 이용 기간">
        <p>회원의 개인정보는 회원 탈퇴 시까지 보관되며, 다음 항목은 관계 법령에 따라 별도 보관됩니다.</p>
        <LegalList
          items={[
            '결제 기록 / 청약철회 등 거래 기록: 5년 (전자상거래법)',
            '소비자 불만 / 분쟁 처리 기록: 3년 (전자상거래법)',
            '로그인 기록 / 접속 로그: 3개월 (통신비밀보호법)',
            '본인확인 결과 (CI/DI): 회원 탈퇴 시 즉시 파기',
            '아티스트 거절된 음원 파일: 거절 후 30일 보관 후 자동 파기',
          ]}
        />
      </LegalSection>

      <LegalSection title="5. 개인정보의 파기 절차 및 방법">
        <LegalList
          items={[
            '파기 절차: 보유기간 도래 또는 처리 목적 달성 시 즉시 파기',
            '전자적 파일: 복구 불가능한 방식으로 영구 삭제',
            '종이 문서: 분쇄기로 분쇄하거나 소각',
            'Supabase Storage 의 음원/커버 파일: bucket delete API 로 영구 삭제',
          ]}
        />
      </LegalSection>

      <LegalSection title="6. 회원의 권리">
        <LegalList
          items={[
            '본인 정보 열람 요청',
            '오류 정정 / 삭제 / 처리정지 요청',
            '회원 탈퇴 (마이페이지 또는 고객센터)',
            '데이터 이동권 (가능한 범위 내)',
          ]}
        />
        <p className="mt-2">
          위 권리 행사는 마이페이지에서 직접 처리하거나{' '}
          <a href="mailto:freemilesarea@gmail.com" className="text-stone-900 underline">
            freemilesarea@gmail.com
          </a>{' '}
          으로 요청 시 지체 없이 조치합니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 개인정보 보호 책임자">
        <LegalList
          items={[
            '책임자: 이승현 (대표)',
            '소속: 루베르 콘텐츠 스튜디오',
            '연락처: freemilesarea@gmail.com',
            '주소: 서울특별시 성동구 왕십리로 326 세신빌딩 6층 614호',
          ]}
        />
      </LegalSection>

      <LegalSection title="8. 방침의 변경">
        <p>
          본 방침은 법령 또는 서비스 정책 변경에 따라 개정될 수 있으며, 변경 시 서비스 내 공지 또는
          이메일로 안내합니다.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
