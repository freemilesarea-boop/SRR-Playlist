import { Mail, Clock, MapPin, Building2 } from 'lucide-react';
import LegalPageLayout, { LegalSection, LegalList } from '@/components/common/LegalPageLayout';

export default function SupportPage() {
  return (
    <LegalPageLayout
      title="고객센터"
      subtitle="궁금하신 점이나 도움이 필요하시면 언제든 연락주세요."
    >
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-700">
            <Mail size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              이메일 문의
            </p>
            <a
              href="mailto:freemilesarea@gmail.com"
              className="mt-1 block text-base font-semibold text-stone-900 hover:underline"
            >
              freemilesarea@gmail.com
            </a>
            <p className="mt-1 text-[12px] text-stone-600">
              평균 1영업일 이내 회신드립니다. 결제·환불 관련 문의는 주문번호를 함께 남겨주시면 빠릅니다.
            </p>
          </div>
        </div>
      </div>

      <LegalSection title="운영 시간">
        <div className="flex items-start gap-2 text-[13.5px]">
          <Clock size={14} className="mt-1 shrink-0 text-stone-500" />
          <div>
            평일 (월~금) 10:00 – 18:00 (KST)
            <br />
            주말 / 공휴일은 응대가 다음 영업일로 순연될 수 있습니다.
          </div>
        </div>
      </LegalSection>

      <LegalSection title="문의 카테고리">
        <p>아래 주제별로 메일 제목을 적어주시면 빠르게 분류해서 처리해드려요.</p>
        <LegalList
          items={[
            '[결제/환불] PayApp 정기결제 / 해지 / 환불 요청',
            '[음원] 아티스트 업로드 / 검수 결과 / 재심사 요청',
            '[계정] 로그인 / 회원 정보 수정 / 탈퇴',
            '[사업자] 매장 모드 / 사업자 검증 / 도입 문의',
            '[광고/제휴] 광고 문의 / B2B 도입 / 큐레이션 협업',
            '[버그/오류] 재생 오류 / 화면 깨짐 / 기타 기술 문제',
          ]}
        />
      </LegalSection>

      <LegalSection title="회사 정보">
        <div className="space-y-2 text-[13px]">
          <div className="flex items-start gap-2">
            <Building2 size={14} className="mt-0.5 shrink-0 text-stone-500" />
            <div>
              <p className="font-semibold text-stone-900">루베르 콘텐츠 스튜디오</p>
              <p className="text-stone-600">대표: 이승현 · 사업자번호: 234-52-00922</p>
              <p className="text-stone-600">통신판매업 신고번호: 2026-서울성동-0724 호</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={14} className="mt-0.5 shrink-0 text-stone-500" />
            <p className="text-stone-700">
              서울특별시 성동구 왕십리로 326 세신빌딩 6층 614호
            </p>
          </div>
        </div>
      </LegalSection>
    </LegalPageLayout>
  );
}
