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
import { X, Send, MessageSquare, Loader2, MessageCircle, Copy, Check } from 'lucide-react';
import { createSupportInquiry, INQUIRY_TYPES, type InquiryType } from '@/lib/supportInquiryApi';
import PayoutIntakeForm from '@/components/PayoutIntakeForm';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import KakaoChannelButtons from '@/components/KakaoChannelButtons';
import { isKakaoChannelConfigured, isKakaoLoginEnabled, openKakaoChannelChat, setKakaoChatPending } from '@/lib/kakao';
import { logSupportContactEvent } from '@/lib/supportContactApi';
import type { User } from '@supabase/supabase-js';

function hasKakaoIdentity(user: User | null | undefined): boolean {
  if (!user?.identities) return false;
  return user.identities.some((i) => i.provider === 'kakao');
}

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
  // X6.20 — '정산 정보 등록' 유형은 PII 가 평문으로 다뤄지지 않도록 별도 폼 위임.
  // X6.53 — hooks 모두 호출 후 분기 (rules-of-hooks 준수, 옛 early-return 패턴 제거)
  const user = useAuthStore((s) => s.user);
  const [inquiryType, setInquiryType] = useState<InquiryType>(defaultType ?? '재생 오류');
  const [titleField, setTitleField] = useState('');
  const [body, setBody] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [wantsKakao, setWantsKakao] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // X6.2.11 — 폼 제출 성공 후 카톡 유도 단계
  const [submittedDraft, setSubmittedDraft] = useState<string | null>(null);
  const [kakaoCopied, setKakaoCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (defaultType) setInquiryType(defaultType);
    setContactEmail(user?.email ?? '');
  }, [open, defaultType, user?.email]);

  // hooks 모두 호출 후 분기 — PayoutIntakeForm 위임 / 닫힘 상태 / 정상 폼
  if (defaultType === '정산 정보 등록') {
    return (
      <PayoutIntakeForm
        open={open}
        onClose={onClose}
        // onSuccess(inquiryId) → onSubmitted() 어댑터 (PayoutIntakeForm 은 인자 없음)
        onSubmitted={onSuccess ? () => onSuccess('') : undefined}
      />
    );
  }

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

      // X6.2.11 — 카톡 채널 있으면 즉시 카톡 유도 모달로 전환.
      // 미리 prefilled 메시지 만들어 클립보드 복사 → 사용자가 채팅창에 붙여넣기.
      if (isKakaoChannelConfigured()) {
        const draft = [
          `[문의: ${inquiryType}] ${titleField.trim()}`,
          '',
          body.trim(),
          '',
          `— 회원 ${user?.email ?? '익명'}`,
          `접수번호: ${res.inquiry_id.slice(0, 8)}`,
        ].join('\n');
        setSubmittedDraft(draft);
        setKakaoCopied(false);
      } else {
        // 카톡 채널 미설정 → 즉시 닫기
        setTitleField('');
        setBody('');
        setWantsKakao(false);
        onClose();
      }
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

        {/* X6.2.11 — 폼 제출 성공 후 카톡 유도 단계 */}
        {submittedDraft ? (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/30">
              <p className="text-[12px] font-bold text-emerald-500">✓ 문의가 접수되었습니다</p>
              <p className="mt-1 text-[11px] text-ink-mute">
                운영팀 이메일에 자동으로 전달됐어요. 더 빠른 답변을 원하면 카톡으로도 보내주세요.
              </p>
            </div>

            <div className="rounded-xl bg-[#FEE500]/15 p-3 ring-1 ring-[#FEE500]/40">
              <p className="mb-2 text-[11px] font-bold flex items-center gap-1">
                <MessageCircle size={12} className="text-[#191919]" />
                카카오톡으로 한 번에 보내기
              </p>
              <p className="mb-2 text-[10px] text-ink-mute">
                ① 아래 내용 복사 → ② 카톡 채널 채팅창 열기 → ③ 채팅창에 붙여넣고 전송
              </p>
              <div className="mb-2 max-h-32 overflow-y-auto rounded-lg bg-bg-card p-2 font-mono text-[10px] whitespace-pre-wrap text-ink">
                {submittedDraft}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(submittedDraft);
                      setKakaoCopied(true);
                      toast.info('문의 내용을 복사했어요. 카톡 채팅창에 붙여넣고 전송하세요.');
                    } catch {
                      toast.error('복사 실패 — 직접 영역을 선택해서 복사해주세요.');
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-2 text-[11px] font-semibold hover:bg-bg-hover"
                >
                  {kakaoCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  {kakaoCopied ? '복사됨' : '내용 복사'}
                </button>
                {/* X6.13 — 카카오 OAuth 활성화 전까지 미연결 사용자에게 카카오 로그인
                    버튼 숨김. 이미 카카오 연결된 사용자는 채널 채팅 진입만 사용. */}
                {(hasKakaoIdentity(user) || isKakaoLoginEnabled()) && (
                  <button
                    onClick={async () => {
                      const userHasKakao = hasKakaoIdentity(user);
                      void logSupportContactEvent({
                        channel: 'kakao',
                        action: 'open_chat',
                        context: { after_form_submit: true, kakao_linked: userHasKakao },
                      });
                      if (userHasKakao) {
                        openKakaoChannelChat();
                      } else {
                        // 카카오 로그인 → 자동 채팅 오픈 (AuthCallback 처리)
                        toast.info('카카오 로그인 후 자동으로 채팅창이 열려요.');
                        setKakaoChatPending();
                        try {
                          await useAuthStore.getState().signInWithKakao();
                        } catch {
                          openKakaoChannelChat();
                        }
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-[#FEE500] px-3 py-2 text-[11px] font-bold text-[#191919] hover:bg-[#FDD800]"
                  >
                    <MessageCircle size={12} />
                    {hasKakaoIdentity(user) ? '@듣다 채팅창 열기' : '카카오 로그인 + 채팅창 열기'}
                  </button>
                )}
              </div>
              <p className="mt-2 text-[10px] text-ink-dim">
                💡 카톡 메시지가 운영자에게 도착하려면 채팅창에 직접 붙여넣기 + 전송 버튼을 누르셔야 합니다.
                카카오 정책상 자동 전송은 불가능합니다.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setTitleField(''); setBody(''); setWantsKakao(false);
                  setSubmittedDraft(null); setKakaoCopied(false);
                  onClose();
                }}
                className="rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover"
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
        <>
        {isKakaoChannelConfigured() && (
          <div className="mb-3 rounded-xl bg-[#FEE500]/15 p-3 ring-1 ring-[#FEE500]/40">
            <p className="mb-1 text-[11px] font-bold">즉시 답변이 필요하면 카톡으로</p>
            <p className="mb-2 text-[10px] text-ink-mute">
              @듣다 채널 채팅방이 열린 뒤 <b>본인 이메일/매장명 + 문의 내용</b>을 직접 메시지로 보내주세요.
              카카오 정책상 사용자는 닉네임으로만 표시되어 별도 식별이 필요합니다.
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
        </>
        )}
      </div>
    </div>
  );
}
