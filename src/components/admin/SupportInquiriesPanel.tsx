/**
 * SupportInquiriesPanel — Phase X6.1
 *
 * 관리자 문의관리.
 * 목록 + 필터 + 상세 + 상태/priority/admin_note 편집.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, MessageSquare,
  Mail, Phone, MessageCircle, ExternalLink, FileText, X,
} from 'lucide-react';
import {
  adminListSupportInquiries, adminGetSupportInquiryDetail, adminUpdateInquiry,
  adminSupportInquirySummary, adminSendInquiryReply, adminListInquiryEvents,
  INQUIRY_TYPES,
  type AdminInquiryRow, type InquiryDetail, type InquiryStatus, type InquiryPriority,
  type InquiryType, type SupportInquirySummary, type InquiryEventRow,
} from '@/lib/supportInquiryApi';
import { isKakaoChannelConfigured, openKakaoChannelChat, kakaoChannelChatUrl, kakaoChannelHomeUrl } from '@/lib/kakao';
import { toast } from '@/store/toastStore';

const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: '신규', in_progress: '처리중', resolved: '답변완료', closed: '종료',
};
const STATUS_TONE: Record<InquiryStatus, string> = {
  open: 'bg-amber-500/15 text-amber-500',
  in_progress: 'bg-sky-500/15 text-sky-500',
  resolved: 'bg-emerald-500/15 text-emerald-500',
  closed: 'bg-ink/15 text-ink-mute',
};
const PRIORITY_TONE: Record<InquiryPriority, string> = {
  urgent: 'bg-rose-500/20 text-rose-500 font-bold',
  high: 'bg-orange-500/20 text-orange-500',
  normal: 'bg-ink/10 text-ink-mute',
  low: 'bg-ink/5 text-ink-dim',
};

export default function SupportInquiriesPanel() {
  const [summary, setSummary] = useState<SupportInquirySummary | null>(null);
  const [rows, setRows] = useState<AdminInquiryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InquiryStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<InquiryType | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<InquiryPriority | ''>('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        adminSupportInquirySummary(30),
        adminListSupportInquiries({
          status: statusFilter || undefined,
          inquiry_type: typeFilter || undefined,
          priority: priorityFilter || undefined,
          search: search.trim() || undefined,
          limit: 200,
        }),
      ]);
      setSummary(sum);
      setRows(list);
    } catch (e) {
      toast.error(`문의 로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [statusFilter, typeFilter, priorityFilter, search]);

  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    try { setDetail(await adminGetSupportInquiryDetail(selectedId)); }
    catch (e) { toast.error(`상세 로딩 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }, [selectedId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function setStatus(id: string, status: InquiryStatus) {
    try {
      await adminUpdateInquiry(id, { status });
      toast.success(`상태 변경 → ${STATUS_LABEL[status]}`);
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
      if (detail?.inquiry.id === id) await loadDetail();
    } catch (e) { toast.error(`상태 변경 실패: ${(e as Error).message}`); }
  }

  async function setPriority(id: string, priority: InquiryPriority) {
    try {
      await adminUpdateInquiry(id, { priority });
      toast.success(`우선순위 변경 → ${priority}`);
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, priority } : r));
      if (detail?.inquiry.id === id) await loadDetail();
    } catch (e) { toast.error(`변경 실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <MessageSquare size={14} /> 문의관리 (X6.1)
          </h2>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          사업자/아티스트/사용자 문의 통합 관리. <b className="text-rose-500">긴급</b> 우선 노출.
          답변은 admin_note 작성 후 상태 변경.
        </p>
      </div>

      {/* 카카오 채널 운영 체크리스트 — 카톡 문의가 안 도착할 때 검토 */}
      {isKakaoChannelConfigured() && (
        <details className="rounded-xl bg-[#FEE500]/10 p-3 ring-1 ring-[#FEE500]/30 text-xs" open>
          <summary className="cursor-pointer font-bold text-[#191919] dark:text-ink">
            ⚠️ 카톡 문의가 도착하지 않는다면? — 운영 확인 필수
          </summary>

          {/* 🔑 가장 중요 — 어디서 봐야 하는지 */}
          <div className="mt-3 rounded-lg bg-rose-500/10 p-3 ring-1 ring-rose-500/30">
            <p className="mb-2 text-[11px] font-bold text-rose-500">
              ⚡ 카톡 채널 메시지는 운영자 "일반 카카오톡"에 안 옵니다!
            </p>
            <p className="mb-2 text-[10px] text-ink">
              아래 둘 중 하나로 봐야 합니다:
            </p>
            <ul className="space-y-1 text-[10px] text-ink-mute">
              <li>
                ① <b>카카오톡 채널 관리자 웹</b>:{' '}
                <a href="https://center-pf.kakao.com" target="_blank" rel="noreferrer"
                  className="text-sky-500 hover:underline">center-pf.kakao.com</a>
                {' '}→ @듣다 → 상담 → 1:1 채팅
              </li>
              <li>
                ② <b>"카카오톡 채널 관리자" 모바일 앱</b> (별도 앱) — 앱스토어/플레이스토어 다운로드 → 채널 관리자 계정 로그인 → 푸시 알림 ON
              </li>
            </ul>
          </div>

          <p className="mt-3 mb-1 text-[11px] font-bold">채널 설정 체크리스트</p>
          <ul className="space-y-1 text-[11px] text-ink-mute">
            <li>
              □ <b>카카오 채널 공개 ON</b> — <a href={kakaoChannelHomeUrl()} target="_blank" rel="noreferrer" className="text-sky-500 hover:underline">@듣다 채널</a> 관리자 → 채널 검색 노출 "공개"
            </li>
            <li>
              □ <b>1:1 채팅 사용 ON</b> — 채널 관리자 → 1:1 채팅 → "사용함"
            </li>
            <li>
              □ <b>1:1 채팅 운영 시간</b> — "24시간" 또는 적절한 시간대 (운영시간 외 메시지는 자동 응답으로만 처리됨)
            </li>
            <li>
              □ <b>운영자 알림 설정 ON</b> — 채널 관리자 앱/웹 알림 + 모바일 OS 알림 권한 둘 다 활성화
            </li>
            <li>
              □ <b>운영자 카카오 계정 채널 권한</b> — pf.kakao.com 채널 → 관리자 권한 부여
            </li>
            <li>
              □ <b>발송 URL 정상</b> — 현재 채팅 URL: <code className="rounded bg-bg-card px-1">{kakaoChannelChatUrl()}</code>
            </li>
            <li>
              □ <b>사용자가 메시지를 실제로 전송했는지</b> — 버튼 클릭만으로는 자동 전송 X.
              사용자가 채팅창 진입 후 직접 텍스트 입력 + 전송 필요.
              <span className="block text-[10px] text-ink-dim mt-0.5">
                support_contact_events 의 channel='kakao' / action='open_chat' = 클릭만 = 입장만 한 상태.
                실제 메시지 도착은 카카오 측에서만 확인 가능.
              </span>
            </li>
          </ul>

          <p className="mt-3 mb-1 text-[11px] font-bold">사용자 식별 (중요)</p>
          <p className="text-[10px] text-ink-mute">
            카카오 정책상 사용자는 <b>익명 닉네임</b>으로만 표시됨 (전화번호/이메일 노출 X).
            우리 측 사용자와 매칭하려면 사용자가 <b>첫 메시지에 이메일/매장명을 직접 입력</b>해야 함.
            FAB 카톡 버튼은 클릭 후 이 안내를 자동 토스트로 표시함.
          </p>
        </details>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="open" v={summary.open} tone="text-amber-500" />
          <Stat label="in_progress" v={summary.in_progress} tone="text-sky-500" />
          <Stat label="urgent open" v={summary.urgent_open} tone="text-rose-500 font-bold" />
          <Stat label="resolved" v={summary.resolved} tone="text-emerald-500" />
          <Stat label="closed" v={summary.closed} />
          <Stat label="total (30d)" v={summary.total} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">상태:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as InquiryStatus | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          {(['open','in_progress','resolved','closed'] as InquiryStatus[]).map((s) =>
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <span className="font-bold">유형:</span>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as InquiryType | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          {INQUIRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="font-bold">우선순위:</span>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as InquiryPriority | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          <option value="urgent">긴급</option>
          <option value="high">높음</option>
          <option value="normal">보통</option>
          <option value="low">낮음</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="검색 (제목/내용/이메일)"
          className="rounded bg-bg-deep px-2 py-1 flex-1 min-w-[160px]" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_500px]">
        {/* 목록 */}
        <div className="rounded-xl bg-bg-card p-3">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-ink-dim">
              {loading ? '로딩 중…' : '문의 없음'}
            </p>
          ) : (
            <ul className="max-h-[700px] space-y-1.5 overflow-y-auto">
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelectedId(r.id)}
                    className={`flex w-full flex-col gap-1 rounded-lg p-2.5 text-left text-xs ${selectedId === r.id ? 'bg-accent/15 ring-1 ring-accent' : 'bg-bg-deep hover:bg-bg-hover'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_TONE[r.priority]}`}>
                        {r.priority}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      <span className="rounded bg-bg-card px-1.5 py-0.5 text-[10px] font-semibold text-ink-mute">
                        {r.inquiry_type}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-dim">
                        {new Date(r.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                      </span>
                    </div>
                    <div className="font-bold">{r.title}</div>
                    <div className="line-clamp-2 text-ink-dim">{r.body}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-dim">
                      <span className="truncate">{r.user_email ?? '—'}</span>
                      {r.user_role && <span className="rounded bg-bg-card px-1 py-0.5 font-mono">{r.user_role}</span>}
                      {r.wants_kakao_contact && <span className="rounded bg-yellow-500/20 px-1 py-0.5 text-yellow-500">카톡</span>}
                      {r.attachment_count > 0 && <span className="rounded bg-violet-500/15 px-1 py-0.5 text-violet-400">첨부 {r.attachment_count}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 상세 */}
        <div className="rounded-xl bg-bg-card p-3">
          {!selectedId ? (
            <p className="py-12 text-center text-[11px] text-ink-dim">왼쪽에서 문의 선택</p>
          ) : detail ? (
            <InquiryDetailView
              detail={detail}
              onClose={() => setSelectedId(null)}
              onChangeStatus={(s) => void setStatus(detail.inquiry.id, s)}
              onChangePriority={(p) => void setPriority(detail.inquiry.id, p)}
              onSendReply={async (reply, status) => {
                try {
                  const { emailResult } = await adminSendInquiryReply(detail.inquiry.id, reply, status);
                  if (emailResult.ok) {
                    toast.success(`답변 발송 — ${emailResult.sent_to} (${STATUS_LABEL[status]})`);
                  } else {
                    toast.error(`답변 저장됐으나 이메일 발송 실패: ${emailResult.error ?? '?'}`);
                  }
                  await loadDetail();
                } catch (e) { toast.error(`답변 실패: ${(e as Error).message}`); }
              }}
            />
          ) : (
            <p className="py-12 text-center text-[11px] text-ink-dim">
              {detailLoading ? '로딩 중…' : '상세 없음'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function InquiryDetailView({
  detail, onClose, onChangeStatus, onChangePriority, onSendReply,
}: {
  detail: InquiryDetail;
  onClose: () => void;
  onChangeStatus: (s: InquiryStatus) => void;
  onChangePriority: (p: InquiryPriority) => void;
  onSendReply: (reply: string, status: 'in_progress' | 'resolved' | 'closed') => Promise<void>;
}) {
  const inq = detail.inquiry;
  const [noteDraft, setNoteDraft] = useState(inq.admin_note ?? '');
  const [replyStatus, setReplyStatus] = useState<'in_progress' | 'resolved' | 'closed'>('resolved');
  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<InquiryEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const ctxEntries = useMemo(() => Object.entries(inq.context ?? {}), [inq.context]);

  useEffect(() => { setNoteDraft(inq.admin_note ?? ''); }, [inq.admin_note]);
  useEffect(() => {
    let alive = true;
    setEventsLoading(true);
    adminListInquiryEvents(inq.id)
      .then((rows) => { if (alive) setEvents(rows); })
      .catch(() => { /* silent */ })
      .finally(() => { if (alive) setEventsLoading(false); });
    return () => { alive = false; };
  }, [inq.id, inq.updated_at]);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_TONE[inq.priority]}`}>{inq.priority}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[inq.status]}`}>{STATUS_LABEL[inq.status]}</span>
            <span className="rounded bg-bg-deep px-1.5 py-0.5 text-[10px]">{inq.inquiry_type}</span>
          </div>
          <h3 className="text-sm font-bold">{inq.title}</h3>
          <p className="font-mono text-[10px] text-ink-dim">
            {new Date(inq.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
      </div>

      {/* 본문 */}
      <div className="rounded-lg bg-bg-deep p-2.5">
        <p className="mb-1 text-[10px] font-bold text-ink-dim">문의 내용</p>
        <p className="whitespace-pre-wrap">{inq.body}</p>
      </div>

      {/* 회원 정보 */}
      <div className="rounded-lg bg-bg-deep p-2.5 space-y-1">
        <p className="mb-1 text-[10px] font-bold text-ink-dim">회원 정보</p>
        <p className="flex items-center gap-1"><Mail size={10} /> {inq.user_email ?? '—'} <span className="text-ink-dim">({inq.user_role ?? '-'})</span></p>
        {inq.contact_phone && <p className="flex items-center gap-1"><Phone size={10} /> {inq.contact_phone}</p>}
        {inq.wants_kakao_contact && (
          <p className="flex items-center gap-1 text-yellow-500"><MessageCircle size={10} /> 카카오톡 상담 희망</p>
        )}
        {detail.business && (
          <p className="text-[10px]">사업자: {(detail.business as { store_name?: string }).store_name ?? '—'}</p>
        )}
        {detail.artist && (
          <p className="text-[10px]">아티스트: {(detail.artist as { artist_name?: string }).artist_name ?? '—'}</p>
        )}
      </div>

      {/* 카톡 답변 도구 — wants_kakao_contact 면 강조 */}
      {isKakaoChannelConfigured() && (
        <div className={`rounded-lg p-2.5 ${inq.wants_kakao_contact ? 'bg-[#FEE500]/20 ring-1 ring-[#FEE500]/40' : 'bg-bg-deep'}`}>
          <p className="mb-1 text-[10px] font-bold text-ink-dim">
            {inq.wants_kakao_contact ? '⚡ 카톡 답변 희망' : '카톡으로 답변 (선택)'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => { openKakaoChannelChat(); }}
              className="inline-flex items-center gap-1 rounded bg-[#FEE500] px-2.5 py-1 text-[10px] font-bold text-[#191919] hover:bg-[#FDD800]"
            >
              <MessageCircle size={10} /> @듣다 채널 채팅 열기
            </button>
            <a href={kakaoChannelChatUrl()} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded bg-bg-card px-2.5 py-1 text-[10px] text-ink-mute hover:text-ink">
              <ExternalLink size={9} /> 새 창에서 열기
            </a>
          </div>
          <p className="mt-1 text-[10px] text-ink-dim">
            채널 채팅창에서 회원 이메일({inq.user_email ?? '—'}) 검색 → 1:1 응대
          </p>
        </div>
      )}

      {/* 컨텍스트 */}
      {ctxEntries.length > 0 && (
        <details className="rounded-lg bg-bg-deep p-2.5">
          <summary className="cursor-pointer text-[10px] font-bold text-ink-dim">컨텍스트 ({ctxEntries.length}개)</summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px]">
            {JSON.stringify(inq.context, null, 2)}
          </pre>
        </details>
      )}

      {/* 첨부파일 */}
      {detail.attachments.length > 0 && (
        <div className="rounded-lg bg-bg-deep p-2.5">
          <p className="mb-1 text-[10px] font-bold text-ink-dim">첨부파일 ({detail.attachments.length})</p>
          <ul className="space-y-1">
            {detail.attachments.map((a) => (
              <li key={a.id}>
                <a href={a.file_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-400 hover:underline">
                  <FileText size={10} /> {a.file_name ?? a.file_url}
                  <ExternalLink size={9} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inq.current_page_url && (
        <p className="text-[10px] text-ink-dim">
          페이지: <a href={inq.current_page_url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{inq.current_page_url}</a>
        </p>
      )}

      {/* 액션 */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] font-bold text-ink-dim">상태</span>
          <select value={inq.status} onChange={(e) => onChangeStatus(e.target.value as InquiryStatus)}
            className="input mt-1 w-full py-1.5 text-xs">
            <option value="open">접수</option>
            <option value="in_progress">확인 중</option>
            <option value="resolved">해결됨</option>
            <option value="closed">종료</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-ink-dim">우선순위</span>
          <select value={inq.priority} onChange={(e) => onChangePriority(e.target.value as InquiryPriority)}
            className="input mt-1 w-full py-1.5 text-xs">
            <option value="urgent">긴급</option>
            <option value="high">높음</option>
            <option value="normal">보통</option>
            <option value="low">낮음</option>
          </select>
        </label>
      </div>

      {/* X6.3 — 답변 작성 + 이메일 자동 발송 */}
      <div className="space-y-2 rounded-lg bg-bg-deep p-2.5">
        <p className="text-[10px] font-bold text-ink-dim">운영팀 답변 (사용자 이메일로 자동 발송)</p>
        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="고객에게 보낼 답변 내용…"
          rows={5} maxLength={4000}
          className="input w-full text-xs resize-y" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-ink-dim">상태:</span>
            <select value={replyStatus} onChange={(e) => setReplyStatus(e.target.value as 'in_progress' | 'resolved' | 'closed')}
              className="rounded bg-bg-card px-2 py-1 text-[11px]">
              <option value="in_progress">처리중</option>
              <option value="resolved">답변완료</option>
              <option value="closed">종료</option>
            </select>
          </label>
          <button
            onClick={async () => {
              if (noteDraft.trim().length === 0) return;
              setSending(true);
              await onSendReply(noteDraft.trim(), replyStatus);
              setSending(false);
            }}
            disabled={sending || noteDraft.trim().length === 0 || !inq.user_email}
            title={!inq.user_email ? '회원 이메일 없음 — 발송 불가' : ''}
            className="rounded bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
          >
            {sending ? '발송 중…' : `답변 보내기 → ${inq.user_email ?? '이메일 없음'}`}
          </button>
        </div>
        <p className="text-[10px] text-ink-dim">
          ⓘ "답변 보내기" 누르면 사용자 이메일로 발송 + 상태가 자동 변경됩니다.
          향후 카카오 알림톡 / 채널 webhook 도 동일 트리거에서 분기 발송됩니다.
        </p>
      </div>

      {/* X6.3 — 이벤트 타임라인 (audit log) */}
      <details className="rounded-lg bg-bg-deep p-2.5" open={events.length > 0 && events.length <= 5}>
        <summary className="cursor-pointer text-[10px] font-bold text-ink-dim">
          이벤트 타임라인 ({events.length})
        </summary>
        {eventsLoading ? (
          <p className="mt-1 text-[10px] text-ink-dim">로딩…</p>
        ) : events.length === 0 ? (
          <p className="mt-1 text-[10px] text-ink-dim">기록 없음</p>
        ) : (
          <ul className="mt-1.5 space-y-1 text-[10px]">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 rounded bg-bg-card p-1.5">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  e.event_type === 'reply_sent' ? 'bg-emerald-500/15 text-emerald-500'
                  : e.event_type === 'reply_failed' || e.event_type.includes('failed') ? 'bg-rose-500/15 text-rose-500'
                  : e.event_type === 'created' ? 'bg-sky-500/15 text-sky-500'
                  : 'bg-ink/10 text-ink-mute'
                }`}>
                  {e.event_type}{e.channel ? `·${e.channel}` : ''}
                </span>
                <span className="min-w-0 flex-1">
                  {e.detail && <span className="block text-ink">{e.detail}</span>}
                  {e.before_data && e.after_data && (
                    <span className="block text-ink-dim font-mono text-[9px]">
                      {JSON.stringify(e.before_data)} → {JSON.stringify(e.after_data)}
                    </span>
                  )}
                  <span className="text-ink-dim">
                    {e.actor_email ?? '시스템'} · {new Date(e.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-bg-card p-3 text-center ring-1 ring-line/10">
      <div className={`text-lg font-extrabold tabular-nums ${tone ?? ''}`}>{v}</div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}
