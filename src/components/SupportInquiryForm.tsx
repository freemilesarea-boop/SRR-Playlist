/**
 * SupportInquiryForm — Phase X6.1
 *
 * 재사용 가능한 문의하기 모달 폼.
 * 어디서든 import 해서 trigger 버튼과 함께 사용.
 *
 * @example
 *   <SupportInquiryForm open={open} onClose={() => setOpen(false)}
 *     defaultType="재생 오류"
 *     context={{ current_playlist_id, current_track_id, queue_length }} />
 */
import { useEffect, useState } from 'react';
import { X, Send, MessageSquare, Loader2 } from 'lucide-react';
import { createSupportInquiry, INQUIRY_TYPES, type InquiryType } from '@/lib/supportInquiryApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import KakaoChannelButtons from '@/components/KakaoChannelButtons';
import { isKakaoChannelConfigured } from '@/lib/kakao';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultType?: InquiryType;
  /** 자동 첨부될 컨텍스트 (예: 매장 재생 상황). 'current_playlist_id' 등 키가 있으면 trigger 가 urgent 자동 설정. */
  context?: Record<string, unknown>;
  /** 매장 재생 화면 등 라벨 커스터마이즈 */
  title?: string;
  /** 성공 토스트 메시지 커스터마이즈. 미지정 시 inquiry_type 기반 자동 선택. */
  successMessage?: string;
  onSuccess?: (inquiryId: string) => void;
}

export default function SupportInquiryForm({
  open, onClose, defaultType, context, title = '문의하기', successMessage, onSuccess,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const [inquiryType, setInquiryType] = useState<InquiryType>(defaultType ?? '재생 오류');
  const [titleField, setTitleField] = useState('');
  const [body, setBody] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [wantsKakao, setWantsKakao] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (defaultType) setInquiryType(defaultType);
    setContactEmail(user?.email ?? '');
  }, [open, defaultType, user?.email]);

  if (!open) return null;

  const isLoggedIn = !!user?.id;

  async function submit() {
    if (!isLoggedIn) {
      toast.error('문의를 보내려면 로그인해주세요.');
      return;
    }
    if (titleField.trim().length === 0 || body.trim().length === 0) {
      toast.error('제목과 내용을 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createSupportInquiry({
        inquiry_type: inquiryType,
        title: titleField,
        body,
        contact_email: contactEmail || undefined,
        contact_phone: contactPhone || undefined,
        wants_kakao_contact: wantsKakao,
        context,
      });
      const msg = successMessage
        ?? (inquiryType === '재생 오류'
            ? '재생 오류 문의가 접수되었습니다. 빠르게 확인하겠습니다.'
            : '문의가 접수되었습니다. 운영팀이 확인 후 연락드리겠습니다.');
      toast.success(msg);
      onSuccess?.(res.inquiry_id);
      // 폼 reset + close
      setTitleField('');
      setBody('');
      setWantsKakao(false);
      onClose();
    } catch (e) {
      toast.error(`문의 전송 실패: ${(e as Error).message}`);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-y-auto rounded-2xl bg-bg-deep p-5 shadow-2xl ring-1 ring-line/10"
        style={{ maxHeight: '90vh' }}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <MessageSquare size={16} className="text-accent" /> {title}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover" aria-label="close">
            <X size={16} />
          </button>
        </div>

        {!isLoggedIn && (
          <div className="mb-3 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-500">
            문의를 보내려면 로그인이 필요합니다.
          </div>
        )}

        {isKakaoChannelConfigured() && (
          <div className="mb-3 rounded-xl bg-[#FEE500]/15 p-3 ring-1 ring-[#FEE500]/40">
            <p className="mb-1 text-[11px] font-bold">즉시 답변이 필요하면 카톡으로</p>
            <p className="mb-2 text-[10px] text-ink-mute">
              @듣다 채널 채팅방이 열린 뒤 <b>메시지를 직접 보내야 접수</b>됩니다.
              버튼 클릭만으로는 자동 전송되지 않습니다.
            </p>
            <KakaoChannelButtons variant="row" size="sm" />
          </div>
        )}

        <div className="space-y-3 text-xs">
          <label className="block">
            <span className="font-semibold">문의 유형 *</span>
            <select value={inquiryType} onChange={(e) => setInquiryType(e.target.value as InquiryType)}
              className="input mt-1 w-full py-2">
              {INQUIRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="font-semibold">제목 *</span>
            <input value={titleField} onChange={(e) => setTitleField(e.target.value)}
              placeholder="간단히 요약해주세요"
              maxLength={200}
              className="input mt-1 w-full py-2" />
          </label>

          <label className="block">
            <span className="font-semibold">내용 *</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="발생한 상황을 자세히 알려주세요. 가능하면 시간, 매장, 곡 제목, 오류 메시지를 함께 적어주세요."
              maxLength={4000} rows={6}
              className="input mt-1 w-full py-2 resize-y" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="font-semibold">연락받을 이메일</span>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                placeholder={user?.email ?? ''}
                className="input mt-1 w-full py-2" />
            </label>
            <label className="block">
              <span className="font-semibold">연락받을 전화 (선택)</span>
              <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                placeholder="010-1234-5678"
                className="input mt-1 w-full py-2" />
            </label>
          </div>

          <label className="flex items-start gap-2 rounded-lg bg-bg-card p-2.5">
            <input type="checkbox" checked={wantsKakao}
              onChange={(e) => setWantsKakao(e.target.checked)}
              className="mt-0.5 shrink-0" />
            <span className="text-[11px]">
              카카오톡으로 답변 받기 희망 (@듣다 채널)
              <span className="block text-[10px] text-ink-dim">
                ⚠️ 자동 전송 아님. 체크 시 운영팀이 @듣다 채널로 응대 시도합니다.
                즉시 답변을 원하면 위 "카톡으로 문의하기" 버튼을 눌러 채팅방을 열고 직접 메시지를 보내주세요.
              </span>
            </span>
          </label>

          {context && Object.keys(context).length > 0 && (
            <details className="rounded-lg bg-bg-card p-2.5 text-[11px]">
              <summary className="cursor-pointer font-semibold">자동 첨부된 정보 ({Object.keys(context).length}개)</summary>
              <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[10px] text-ink-dim">
                {JSON.stringify(context, null, 2)}
              </pre>
              <p className="mt-1 text-[10px] text-ink-dim">
                재생 상황 자동 첨부 — 빠른 진단에 도움이 됩니다.
              </p>
            </details>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting}
            className="rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
            취소
          </button>
          <button onClick={() => void submit()} disabled={submitting || !isLoggedIn}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-bold text-black disabled:opacity-50">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {submitting ? '전송 중…' : '문의 보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
