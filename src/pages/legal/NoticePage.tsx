import { Megaphone } from 'lucide-react';
import LegalPageLayout from '@/components/common/LegalPageLayout';

export default function NoticePage() {
  return (
    <LegalPageLayout title="공지사항" subtitle="스르륵 플리의 새 소식과 업데이트가 게시됩니다.">
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-stone-200 bg-white/60 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500">
          <Megaphone size={20} />
        </div>
        <h2 className="text-base font-semibold text-stone-900">공지사항 준비 중입니다</h2>
        <p className="text-[13px] text-stone-600">
          서비스 업데이트 소식이 곧 올라올 예정이에요. <br />
          긴급한 안내는 가입하신 이메일로 발송됩니다.
        </p>
        <a
          href="mailto:freemilesarea@gmail.com?subject=스르륵 플리 문의"
          className="mt-2 inline-flex rounded-full bg-stone-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-stone-800"
        >
          이메일 문의하기
        </a>
      </div>
    </LegalPageLayout>
  );
}
