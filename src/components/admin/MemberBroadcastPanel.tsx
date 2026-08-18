import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Send, History, Ban, Search, Loader2, X, Check, Clock, AlertTriangle } from 'lucide-react';
import {
  AdminCard, AdminSection, AdminButton, AdminBadge, AdminAlert, AdminModal, AdminEmpty,
} from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { fetchMemberList, type MemberRow } from '@/lib/adminApi';
import {
  type EmailKind, type RecipientMode, type CampaignStatus,
  EMAIL_KIND_LABEL, RECIPIENT_MODE_LABEL, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE,
  buildBroadcastSubject, validateBroadcastDraft, summarizeSend,
} from '@/lib/broadcastEmail';
import {
  previewBroadcastRecipients, createBroadcastCampaign, drainBroadcastUntilDone, sendBroadcastTest,
  listBroadcastCampaigns, getBroadcastCampaign, cancelBroadcastCampaign,
  listEmailUnsubscribes, addEmailUnsubscribe, removeEmailUnsubscribe,
  type CampaignRow, type UnsubscribeRow, type RecipientFilter,
} from '@/lib/adminBroadcastApi';

type SubTab = 'compose' | 'history' | 'unsubscribes';

export default function MemberBroadcastPanel() {
  const [sub, setSub] = useState<SubTab>('compose');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail size={18} className="text-ink" />
          <div>
            <h2 className="text-lg font-bold tracking-tight">회원 메일 발송</h2>
            <p className="text-xs text-ink-mute">전체·검색·선택한 회원에게 메일을 보냅니다.</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        {([['compose', '작성·발송', <Send size={13} key="c" />],
          ['history', '발송 이력', <History size={13} key="h" />],
          ['unsubscribes', '수신거부 관리', <Ban size={13} key="u" />]] as const).map(([k, label, icon]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              sub === k ? 'bg-bg-hover text-ink' : 'text-ink-mute hover:text-ink'
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {sub === 'compose' && <ComposeTab />}
      {sub === 'history' && <HistoryTab />}
      {sub === 'unsubscribes' && <UnsubscribeTab />}
    </div>
  );
}

/* ─────────────────────────── 작성·발송 ─────────────────────────── */

function ComposeTab() {
  const [kind, setKind] = useState<EmailKind>('notice');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [mode, setMode] = useState<RecipientMode>('all');
  const [filter, setFilter] = useState<RecipientFilter>({});
  const [selected, setSelected] = useState<Map<string, MemberRow>>(new Map());

  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  const [preview, setPreview] = useState<{ count: number; excluded: number; sample: Array<{ email: string; nickname: string | null }> } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const selectedIds = useMemo(() => Array.from(selected.keys()), [selected]);

  const refreshPreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const p = await previewBroadcastRecipients({
        mode, filter: mode === 'filter' ? filter : {}, selectedUserIds: mode === 'selected' ? selectedIds : [], kind,
      });
      setPreview({ count: p.count, excluded: p.excluded_unsubscribed, sample: p.sample });
    } catch (e) {
      setPreview(null);
      toast.error(friendlyError(e, '수신자 미리보기 실패'));
    } finally {
      setPreviewing(false);
    }
  }, [mode, filter, selectedIds, kind]);

  // 모드/필터/선택/유형 변경 시 자동 미리보기(디바운스)
  useEffect(() => {
    const t = setTimeout(() => { void refreshPreview(); }, 350);
    return () => clearTimeout(t);
  }, [refreshPreview]);

  const scheduledIso = scheduleOn && scheduledAt ? new Date(scheduledAt).toISOString() : null;
  const validation = validateBroadcastDraft(
    { subject, bodyHtml, kind, mode, selectedCount: selected.size, scheduledAt: scheduledIso },
  );

  async function onTest() {
    if (!subject.trim() || !bodyHtml.trim()) { toast.error('제목과 본문을 입력해주세요.'); return; }
    setTesting(true);
    try {
      const r = await sendBroadcastTest({ subject, bodyHtml, kind, to: testTo.trim() || undefined });
      if (r.ok) toast.success(`테스트 메일을 보냈어요${r.to ? ` (${r.to})` : ''}.`);
      else toast.error(r.error || '테스트 발송 실패');
    } catch (e) {
      toast.error(friendlyError(e, '테스트 발송 실패'));
    } finally {
      setTesting(false);
    }
  }

  async function onConfirmSend() {
    setSending(true);
    try {
      const res = await createBroadcastCampaign({
        subject, bodyHtml, kind, mode,
        filter: mode === 'filter' ? filter : {},
        selectedUserIds: mode === 'selected' ? selectedIds : [],
        scheduledAt: scheduledIso,
      });
      setConfirmOpen(false);
      if (res.status === 'scheduled') {
        toast.success(`${res.total_recipients.toLocaleString('ko-KR')}명 예약 발송 등록 완료.`);
      } else {
        toast.success(`${res.total_recipients.toLocaleString('ko-KR')}명에게 발송을 시작합니다…`);
        const d = await drainBroadcastUntilDone();
        toast.success(`발송 완료 — 성공 ${d.sent}건${d.failed ? `, 실패 ${d.failed}건` : ''}.`);
      }
      // reset compose
      setSubject(''); setBodyHtml(''); setSelected(new Map());
    } catch (e) {
      toast.error(friendlyError(e, '발송 실패'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,320px]">
      {/* 왼쪽: 작성 */}
      <div className="space-y-4">
        <AdminCard title="메일 내용">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-mute">메일 유형</label>
              <div className="flex gap-2">
                {(['notice', 'ad'] as EmailKind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ring-1 transition ${
                      kind === k ? 'bg-bg-hover text-ink ring-line/30' : 'bg-bg-card text-ink-mute ring-line/10 hover:text-ink'
                    }`}
                  >
                    {EMAIL_KIND_LABEL[k]}
                    <span className="ml-1 text-[10px] text-ink-dim">
                      {k === 'ad' ? '[광고] 표기·수신거부 포함' : '안내/운영'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-mute">제목</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="메일 제목"
                className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40"
              />
              {kind === 'ad' && (
                <p className="mt-1 text-[11px] text-ink-dim">실제 발송 제목: <span className="font-mono">{buildBroadcastSubject(subject || '(제목)', 'ad')}</span></p>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-semibold text-ink-mute">본문 (HTML 가능)</label>
                <button onClick={() => setShowPreview((v) => !v)} className="text-[11px] text-ink-mute hover:text-ink">
                  {showPreview ? '편집' : '미리보기'}
                </button>
              </div>
              {showPreview ? (
                <iframe
                  title="메일 미리보기"
                  className="h-64 w-full rounded-lg bg-white ring-1 ring-line/15"
                  srcDoc={`<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#18181b;padding:12px">${bodyHtml || '<p style="color:#a1a1aa">(본문 미리보기)</p>'}</div>`}
                />
              ) : (
                <textarea
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  placeholder={'안녕하세요, 듣다입니다.\n\n<b>굵게</b>, <a href="https://deudda.com">링크</a> 등 HTML 을 사용할 수 있어요.'}
                  className="h-64 w-full resize-y rounded-lg bg-bg-card px-3 py-2 font-mono text-[13px] text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40"
                />
              )}
            </div>
          </div>
        </AdminCard>

        <AdminCard title="테스트 발송" subtitle="본인(또는 지정 주소)에게 먼저 보내 확인하세요.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="받는 주소 (비우면 내 계정)"
              className="flex-1 rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40"
            />
            <AdminButton tone="neutral" variant="outline" size="sm" onClick={onTest} disabled={testing}
              leftIcon={testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}>
              테스트 발송
            </AdminButton>
          </div>
        </AdminCard>
      </div>

      {/* 오른쪽: 수신자 + 발송 */}
      <div className="space-y-4">
        <AdminCard title="수신자">
          <div className="space-y-3">
            <div className="flex gap-1 rounded-lg bg-bg-card p-1 ring-1 ring-line/10">
              {(['all', 'filter', 'selected'] as RecipientMode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                    mode === m ? 'bg-bg-hover text-ink' : 'text-ink-mute hover:text-ink'
                  }`}>
                  {RECIPIENT_MODE_LABEL[m]}
                </button>
              ))}
            </div>

            {mode === 'filter' && <FilterControls filter={filter} onChange={setFilter} />}
            {mode === 'selected' && <MemberPicker selected={selected} onChange={setSelected} />}

            <div className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-mute">발송 대상</span>
                <span className="text-lg font-extrabold tabular-nums text-ink">
                  {previewing ? <Loader2 size={16} className="animate-spin text-ink-mute" /> : (preview?.count ?? 0).toLocaleString('ko-KR')}
                  <span className="ml-0.5 text-xs font-semibold text-ink-mute">명</span>
                </span>
              </div>
              {kind === 'ad' && preview && preview.excluded > 0 && (
                <p className="mt-1 text-[11px] text-ink-dim">수신거부 {preview.excluded.toLocaleString('ko-KR')}명 자동 제외됨</p>
              )}
              {preview && preview.sample.length > 0 && (
                <p className="mt-1 truncate text-[11px] text-ink-dim">
                  예: {preview.sample.slice(0, 3).map((s) => s.email).join(', ')}
                  {preview.count > 3 ? ' …' : ''}
                </p>
              )}
            </div>
          </div>
        </AdminCard>

        <AdminCard title="발송 시점">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
            예약 발송
          </label>
          {scheduleOn && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-2 w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40"
            />
          )}
        </AdminCard>

        {!validation.ok && (
          <AdminAlert tone="warning" title="확인 필요" description={validation.errors.join(' ')} />
        )}

        <AdminButton
          tone="primary" size="lg" fullWidth
          disabled={!validation.ok || (preview?.count ?? 0) === 0 || sending}
          leftIcon={<Send size={15} />}
          onClick={() => setConfirmOpen(true)}
        >
          {scheduleOn ? '예약 발송 등록' : '지금 발송'}
        </AdminButton>
      </div>

      <AdminModal
        open={confirmOpen}
        onClose={() => !sending && setConfirmOpen(false)}
        title="발송을 확인해주세요"
        size="sm"
        footer={
          <>
            <AdminButton tone="neutral" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={sending}>취소</AdminButton>
            <AdminButton tone="primary" onClick={onConfirmSend} disabled={sending}
              leftIcon={sending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}>
              {scheduleOn ? '예약 등록' : '발송'}
            </AdminButton>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink">
          <p>{summarizeSend({ kind, mode, scheduledAt: scheduledIso }, preview?.count ?? 0)}</p>
          <div className="rounded-lg bg-bg-card p-3 text-xs text-ink-mute ring-1 ring-line/10">
            <p className="truncate"><span className="text-ink-dim">제목</span> · {buildBroadcastSubject(subject, kind)}</p>
            <p className="mt-1"><span className="text-ink-dim">유형</span> · {EMAIL_KIND_LABEL[kind]}
              {kind === 'ad' && ' (수신거부 링크 포함)'}</p>
          </div>
          {kind === 'ad' && (
            <AdminAlert tone="info" description="광고성 메일은 제목에 [광고]가 표기되고, 하단에 무료 수신거부 링크가 포함됩니다." />
          )}
        </div>
      </AdminModal>
    </div>
  );
}

function FilterControls({ filter, onChange }: { filter: RecipientFilter; onChange: (f: RecipientFilter) => void }) {
  return (
    <div className="space-y-2">
      <input
        value={filter.search ?? ''}
        onChange={(e) => onChange({ ...filter, search: e.target.value || null })}
        placeholder="이메일·닉네임 검색"
        className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40"
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={filter.plan ?? ''} onChange={(e) => onChange({ ...filter, plan: e.target.value || null })}
          className="rounded-lg bg-bg-card px-2 py-2 text-xs text-ink ring-1 ring-line/15 focus:ring-line/40">
          <option value="">플랜 전체</option>
          <option value="free">무료</option>
          <option value="individual">일반</option>
          <option value="business">사업자</option>
        </select>
        <select value={filter.status ?? 'active'} onChange={(e) => onChange({ ...filter, status: e.target.value || null })}
          className="rounded-lg bg-bg-card px-2 py-2 text-xs text-ink ring-1 ring-line/15 focus:ring-line/40">
          <option value="active">활성 회원</option>
          <option value="">상태 전체</option>
        </select>
      </div>
      <p className="text-[11px] text-ink-dim">탈퇴·비활성·마스킹 계정과 이메일 없는 계정은 항상 자동 제외됩니다.</p>
    </div>
  );
}

function MemberPicker({ selected, onChange }: { selected: Map<string, MemberRow>; onChange: (m: Map<string, MemberRow>) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await fetchMemberList({ search: q || undefined, status: 'active', limit: 30 });
        setRows(list.filter((r) => r.email));
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  function toggle(r: MemberRow) {
    const next = new Map(selected);
    if (next.has(r.id)) next.delete(r.id); else next.set(r.id, r);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회원 검색 후 선택"
          className="w-full rounded-lg bg-bg-card py-2 pl-7 pr-3 text-sm text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40" />
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from(selected.values()).slice(0, 12).map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-bg-hover px-2 py-0.5 text-[11px] text-ink">
              {r.nickname || r.email}
              <button onClick={() => toggle(r)} className="text-ink-dim hover:text-ink"><X size={10} /></button>
            </span>
          ))}
          {selected.size > 12 && <span className="text-[11px] text-ink-dim">외 {selected.size - 12}명</span>}
        </div>
      )}
      <div className="max-h-52 overflow-y-auto rounded-lg ring-1 ring-line/10">
        {loading ? (
          <div className="p-4 text-center text-xs text-ink-mute"><Loader2 size={14} className="mx-auto animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-xs text-ink-mute">검색 결과가 없어요</p>
        ) : rows.map((r) => (
          <button key={r.id} onClick={() => toggle(r)}
            className="flex w-full items-center justify-between gap-2 border-t border-line/10 px-3 py-2 text-left first:border-t-0 hover:bg-bg-hover">
            <span className="min-w-0">
              <span className="block truncate text-sm text-ink">{r.nickname || '—'}</span>
              <span className="block truncate text-[11px] text-ink-dim">{r.email}</span>
            </span>
            {selected.has(r.id) && <Check size={14} className="shrink-0 text-ink" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── 발송 이력 ─────────────────────────── */

function HistoryTab() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listBroadcastCampaigns(50, 0)); }
    catch (e) { toast.error(friendlyError(e, '이력 불러오기 실패')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="p-6 text-sm text-ink-mute">불러오는 중…</p>;
  if (rows.length === 0) return <AdminEmpty icon={<History size={26} />} title="발송 이력이 없어요" description="첫 메일을 보내보세요." />;

  return (
    <>
      <AdminSection title="발송 이력" action={<AdminButton tone="neutral" variant="ghost" size="sm" onClick={load}>새로고침</AdminButton>}>
        <div className="overflow-hidden rounded-xl ring-1 ring-line/10">
          {rows.map((c) => (
            <button key={c.id} onClick={() => setDetail(c.id)}
              className="flex w-full items-center justify-between gap-3 border-t border-line/10 px-4 py-3 text-left first:border-t-0 hover:bg-bg-hover">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  {c.email_kind === 'ad' && <AdminBadge tone="info" size="sm">광고</AdminBadge>}
                  <span className="truncate text-sm font-medium text-ink">{c.subject}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-dim">
                  {RECIPIENT_MODE_LABEL[c.recipient_mode]} · {new Date(c.created_at).toLocaleString('ko-KR')}
                  {c.scheduled_at && ` · 예약 ${new Date(c.scheduled_at).toLocaleString('ko-KR')}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold tabular-nums text-ink">{c.sent_count.toLocaleString('ko-KR')}<span className="text-ink-dim">/{c.total_recipients.toLocaleString('ko-KR')}</span></p>
                {c.failed_count > 0 && <p className="text-[11px] text-ink-mute">실패 {c.failed_count}</p>}
              </div>
            </button>
          ))}
        </div>
      </AdminSection>
      {detail && <CampaignDetailModal id={detail} onClose={() => setDetail(null)} onChanged={load} />}
    </>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return <AdminBadge tone={CAMPAIGN_STATUS_TONE[status]} size="sm">{CAMPAIGN_STATUS_LABEL[status]}</AdminBadge>;
}

function CampaignDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getBroadcastCampaign>>>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => { (async () => {
    setLoading(true);
    try { setData(await getBroadcastCampaign(id)); }
    catch (e) { toast.error(friendlyError(e, '상세 불러오기 실패')); }
    finally { setLoading(false); }
  })(); }, [id]);

  const c = data?.campaign;
  const canCancel = c && (c.status === 'scheduled' || c.status === 'sending');

  async function onCancel() {
    setCancelling(true);
    try { await cancelBroadcastCampaign(id); toast.success('캠페인을 취소했어요.'); onChanged(); onClose(); }
    catch (e) { toast.error(friendlyError(e, '취소 실패')); }
    finally { setCancelling(false); }
  }

  return (
    <AdminModal open onClose={onClose} title="캠페인 상세" size="md"
      footer={canCancel ? (
        <AdminButton tone="danger" variant="subtle" onClick={onCancel} disabled={cancelling}
          leftIcon={cancelling ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}>
          {c?.status === 'scheduled' ? '예약 취소' : '발송 중단'}
        </AdminButton>
      ) : <AdminButton tone="neutral" variant="ghost" onClick={onClose}>닫기</AdminButton>}>
      {loading || !c ? (
        <p className="py-8 text-center text-sm text-ink-mute">불러오는 중…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={c.status} />
            {c.email_kind === 'ad' && <AdminBadge tone="info" size="sm">광고</AdminBadge>}
          </div>
          <p className="text-sm font-semibold text-ink">{c.subject}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="대상" value={c.total_recipients} />
            <Stat label="성공" value={c.sent_count} />
            <Stat label="실패" value={c.failed_count} />
          </div>
          <div className="rounded-lg bg-bg-card p-3 text-xs text-ink-mute ring-1 ring-line/10">
            <p>수신자 · {RECIPIENT_MODE_LABEL[c.recipient_mode]}</p>
            <p className="mt-1">생성 · {new Date(c.created_at).toLocaleString('ko-KR')}{c.created_by_email ? ` · ${c.created_by_email}` : ''}</p>
            {c.scheduled_at && <p className="mt-1">예약 · {new Date(c.scheduled_at).toLocaleString('ko-KR')}</p>}
            {c.completed_at && <p className="mt-1">완료 · {new Date(c.completed_at).toLocaleString('ko-KR')}</p>}
          </div>
          {data && data.recent_failures.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-mute"><AlertTriangle size={12} /> 최근 실패</p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {data.recent_failures.map((f, i) => (
                  <div key={i} className="rounded-md bg-bg-card px-2 py-1.5 text-[11px] ring-1 ring-line/10">
                    <span className="text-ink">{f.email}</span>
                    <span className="ml-1 text-ink-dim">{f.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminModal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-card p-2 ring-1 ring-line/10">
      <p className="text-[10px] text-ink-dim">{label}</p>
      <p className="text-base font-extrabold tabular-nums text-ink">{value.toLocaleString('ko-KR')}</p>
    </div>
  );
}

/* ─────────────────────────── 수신거부 관리 ─────────────────────────── */

function UnsubscribeTab() {
  const [rows, setRows] = useState<UnsubscribeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const load = useCallback(async (search?: string) => {
    setLoading(true);
    try { setRows(await listEmailUnsubscribes(200, 0, search || undefined)); }
    catch (e) { toast.error(friendlyError(e, '수신거부 목록 실패')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onAdd() {
    if (!newEmail.trim()) return;
    try { await addEmailUnsubscribe(newEmail.trim()); toast.success('수신거부에 추가했어요.'); setNewEmail(''); load(q); }
    catch (e) { toast.error(friendlyError(e, '추가 실패')); }
  }
  async function onRemove(email: string) {
    try { await removeEmailUnsubscribe(email); toast.success('수신거부에서 제외했어요.'); load(q); }
    catch (e) { toast.error(friendlyError(e, '제외 실패')); }
  }

  return (
    <AdminSection title="수신거부 관리" description="광고성 메일 발송 시 이 목록의 주소는 자동으로 제외됩니다.">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(q)}
            placeholder="이메일 검색" className="w-full rounded-lg bg-bg-card py-2 pl-7 pr-3 text-sm text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40" />
        </div>
        <div className="flex gap-2">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="수동 추가할 이메일"
            className="flex-1 rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 placeholder:text-ink-dim focus:ring-line/40" />
          <AdminButton tone="neutral" variant="outline" size="sm" onClick={onAdd}>추가</AdminButton>
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-ink-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <AdminEmpty icon={<Ban size={26} />} title="수신거부 내역이 없어요" />
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-line/10">
          {rows.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 border-t border-line/10 px-4 py-2.5 first:border-t-0">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{u.email}</p>
                <p className="text-[11px] text-ink-dim">
                  <Clock size={9} className="mr-0.5 inline" />{new Date(u.unsubscribed_at).toLocaleString('ko-KR')} · {u.source === 'admin' ? '수동' : '링크'}
                </p>
              </div>
              <button onClick={() => onRemove(u.email)} className="text-[11px] text-ink-mute hover:text-ink">제외</button>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
