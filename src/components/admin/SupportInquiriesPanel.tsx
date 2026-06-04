/**
 * SupportInquiriesPanel — Phase X6.1
 *
 * 관리자 문의관리.
 * 목록 + 필터 + 상세 + 상태/priority/admin_note 편집.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, MessageSquare, AlertOctagon, AlertTriangle, CheckCircle2, Clock,
  Mail, Phone, MessageCircle, ExternalLink, FileText, X,
} from 'lucide-react';
import {
  adminListSupportInquiries, adminGetSupportInquiryDetail, adminUpdateInquiry,
  adminSupportInquirySummary,
  INQUIRY_TYPES,
  type AdminInquiryRow, type InquiryDetail, type InquiryStatus, type InquiryPriority,
  type InquiryType, type SupportInquirySummary,
} from '@/lib/supportInquiryApi';
import { isKakaoChannelConfigured, openKakaoChannelChat, kakaoChannelChatUrl } from '@/lib/kakao';
import { toast } from '@/store/toastStore';

const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: '접수', in_progress: '확인 중', resolved: '해결됨', closed: '종료',
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
              onSaveNote={async (note) => {
                try {
                  await adminUpdateInquiry(detail.inquiry.id, { admin_note: note });
                  toast.success('답변 저장');
                  await loadDetail();
                } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
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
  detail, onClose, onChangeStatus, onChangePriority, onSaveNote,
}: {
  detail: InquiryDetail;
  onClose: () => void;
  onChangeStatus: (s: InquiryStatus) => void;
  onChangePriority: (p: InquiryPriority) => void;
  onSaveNote: (note: string) => Promise<void>;
}) {
  const inq = detail.inquiry;
  const [noteDraft, setNoteDraft] = useState(inq.admin_note ?? '');
  const [saving, setSaving] = useState(false);
  const ctxEntries = useMemo(() => Object.entries(inq.context ?? {}), [inq.context]);

  useEffect(() => { setNoteDraft(inq.admin_note ?? ''); }, [inq.admin_note]);

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
              onClick={() => void openKakaoChannelChat()}
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

      <div className="space-y-1">
        <p className="text-[10px] font-bold text-ink-dim">운영팀 답변 / 메모</p>
        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="고객에게 보여질 답변 또는 운영 메모…"
          rows={4} maxLength={2000}
          className="input w-full text-xs resize-y" />
        <button onClick={async () => { setSaving(true); await onSaveNote(noteDraft); setSaving(false); }}
          disabled={saving}
          className="rounded bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
          {saving ? '저장 중…' : '답변 저장'}
        </button>
      </div>
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
