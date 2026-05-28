import { useEffect, useState } from 'react';
import { Plus, X, RefreshCw, Eye, FileText, CheckCircle2, Clock, XCircle } from 'lucide-react';
import {
  adminListContracts,
  adminCreateContract,
  adminListContractEmailJobs,
  adminListContractEmailEvents,
  adminRequeueContractEmails,
  adminEnqueueContractEmails,
  dispatchContractEmails,
  checkDispatchHealth,
  ARTIST_CONTRACT_V1_BODY,
  ARTIST_CONTRACT_V1_VERSION,
  ARTIST_CONTRACT_V1_TITLE,
  type AdminContractRow,
  type ContractStatus,
  type ContractEmailJob,
  type ContractEmailEvent,
  type DispatchHealth,
} from '@/lib/artistContractApi';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR');
}

const STATUS_LABEL: Record<ContractStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  pending_signature: {
    label: '서명 대기',
    tone: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
    icon: <Clock size={11} />,
  },
  signed: {
    label: '서명 완료',
    tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
    icon: <CheckCircle2 size={11} />,
  },
  rejected: {
    label: '거절됨',
    tone: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
    icon: <XCircle size={11} />,
  },
  expired: {
    label: '만료',
    tone: 'bg-ink/10 text-ink-dim',
    icon: <Clock size={11} />,
  },
};

export default function ArtistContractsList() {
  const [rows, setRows] = useState<AdminContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ContractStatus | ''>('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<AdminContractRow | null>(null);
  const [health, setHealth] = useState<DispatchHealth | { ok: false; error: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListContracts({ status: status || undefined, search: search || undefined });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // 메일 환경설정 health check (mount 시 1회)
  useEffect(() => {
    void (async () => {
      const h = await checkDispatchHealth();
      setHealth(h);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">아티스트 계약 관리</h2>
          <p className="text-xs text-ink-mute">
            {rows.length}건 · 승인 + 결제 완료 아티스트만 계약서 생성 가능
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
          >
            <RefreshCw size={12} /> 새로고침
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/90"
          >
            <Plus size={12} /> 계약서 생성
          </button>
        </div>
      </div>

      {error && <Alert tone="error" title="계약 목록 조회 실패">{error}</Alert>}

      <DispatchHealthBanner health={health} onRecheck={async () => setHealth(await checkDispatchHealth())} />

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이메일 또는 닉네임 검색"
          className="input flex-1 min-w-[180px] text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ContractStatus | '')}
          className="input w-auto text-sm"
        >
          <option value="">전체 상태</option>
          <option value="pending_signature">서명 대기</option>
          <option value="signed">서명 완료</option>
          <option value="rejected">거절됨</option>
          <option value="expired">만료</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
                <th className="px-3 py-2.5 text-left font-semibold">계약 버전</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-right font-semibold">발행일</th>
                <th className="px-3 py-2.5 text-right font-semibold">서명일</th>
                <th className="px-3 py-2.5 text-right font-semibold">만료일</th>
                <th className="w-px px-3 py-2.5 text-right font-semibold">상세</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">불러오는 중…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                    계약서가 없어요. 우측 상단에서 발행해주세요.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const meta = STATUS_LABEL[r.status];
                return (
                  <tr key={r.id} className="border-b border-line/10 hover:bg-bg-hover">
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.artist_nickname || '—'}</p>
                      <p className="text-xs text-ink-mute">{r.artist_email || r.artist_user_id.slice(0, 8)}</p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.contract_version}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-mute">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-mute">{fmtDate(r.signed_at)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-mute">{fmtDate(r.expires_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => setDetailRow(r)}
                        className="rounded p-1.5 hover:bg-ink/5"
                        title="상세"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <CreateContractModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      )}

      {detailRow && <ContractDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  );
}

// ============================================
// 계약서 생성 모달
// ============================================

interface EligibleArtist {
  id: string;
  email: string | null;
  nickname: string | null;
}

function CreateContractModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [artists, setArtists] = useState<EligibleArtist[]>([]);
  const [artistUserId, setArtistUserId] = useState('');
  const [version, setVersion] = useState(ARTIST_CONTRACT_V1_VERSION);
  const [title, setTitle] = useState(ARTIST_CONTRACT_V1_TITLE);
  const [body, setBody] = useState(ARTIST_CONTRACT_V1_BODY);
  const [expiresAt, setExpiresAt] = useState(''); // YYYY-MM-DD
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 발행 가능한 아티스트 후보: approved + 결제 완료 + (계약 미발행 또는 만료/거절)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 승인 단일 진실원천 = artist_profiles.approval_status.
        // users 미러(account_type/artist_approval_status)로 필터하면 sync 깨진 승인 아티스트가
        // 후보에서 누락되므로, artist_profiles(approved)에서 user_id 를 얻고 users 는 결제등급만 확인.
        const { data: profs, error: pe } = await supabase
          .from('artist_profiles')
          .select('user_id, artist_name')
          .eq('approval_status', 'approved');
        if (pe) throw pe;
        const ids = (profs ?? []).map((p) => (p as { user_id: string }).user_id);
        if (ids.length === 0) {
          if (alive) setArtists([]);
          return;
        }
        const nameByUid = new Map(
          (profs ?? []).map((p) => {
            const r = p as { user_id: string; artist_name: string | null };
            return [r.user_id, r.artist_name];
          }),
        );
        const { data, error: e } = await supabase
          .from('users')
          .select('id, nickname, membership_tier')
          .in('id', ids)
          .in('membership_tier', ['individual', 'business']);
        if (e) throw e;
        const list = (data ?? []) as Array<{
          id: string;
          nickname: string | null;
          membership_tier: string;
        }>;
        const mapped: EligibleArtist[] = list.map((u) => ({
          id: u.id,
          email: null,
          nickname: u.nickname ?? nameByUid.get(u.id) ?? null,
        }));
        if (alive) setArtists(mapped);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!artistUserId) {
      setError('대상 아티스트를 선택해주세요.');
      return;
    }
    if (body.trim().length < 100) {
      setError('계약 본문이 너무 짧아요 (최소 100자).');
      return;
    }
    setBusy(true);
    try {
      const expIso = expiresAt ? new Date(expiresAt + 'T23:59:59+09:00').toISOString() : null;
      await adminCreateContract({
        artistUserId,
        contractVersion: version.trim(),
        contractTitle: title.trim(),
        contractBody: body,
        expiresAt: expIso,
      });
      toast.success('계약서가 발행됐어요. 아티스트가 동의하면 음원 등록 가능.');
      onCreated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('already exists')
          ? '이미 동일 버전 계약서가 존재해요. 버전을 변경해주세요.'
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h3 className="text-base font-bold">계약서 발행</h3>
          <button onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          <Alert tone="info">
            승인 + 결제 완료된 아티스트만 노출됩니다. 동일 버전은 한 아티스트당 1건만 발행 가능
            (재발행 필요 시 새 버전 — 예: v1.1).
          </Alert>

          <Field label="대상 아티스트 *">
            <select
              required
              value={artistUserId}
              onChange={(e) => setArtistUserId(e.target.value)}
              className="input"
            >
              <option value="">— 선택 —</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname || '이름없음'} ({a.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </Field>

          <Field label="계약 버전 *">
            <input
              type="text"
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="input font-mono"
              placeholder="예: v1, v1.1"
            />
          </Field>

          <Field label="계약 제목 *">
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </Field>

          <Field label="서명 만료일 (선택)" hint="비워두면 만료 없음">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="input"
            />
          </Field>

          <Field label="계약 본문 *" hint="아티스트 동의 시점에 immutable 스냅샷으로 저장">
            <textarea
              required
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input font-mono text-[11px]"
            />
            <span className="block text-[10px] text-ink-dim">길이: {body.length}자</span>
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-ghost py-2 text-sm">
              취소
            </button>
            <button type="submit" disabled={busy} className="flex-1 btn-primary py-2 text-sm">
              {busy ? '발행 중…' : '계약서 발행'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// 계약서 상세 모달 — read-only + 메일 발송 상태/재발송
// ============================================
function ContractDetailModal({ row, onClose }: { row: AdminContractRow; onClose: () => void }) {
  const [emailJobs, setEmailJobs] = useState<ContractEmailJob[] | null>(null);
  const [emailEvents, setEmailEvents] = useState<ContractEmailEvent[] | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  async function loadJobs() {
    setEmailLoading(true);
    setEmailErr(null);
    try {
      const [jobs, events] = await Promise.all([
        adminListContractEmailJobs(row.id),
        adminListContractEmailEvents(row.id).catch(() => []),
      ]);
      setEmailJobs(jobs);
      setEmailEvents(events);
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailLoading(false);
    }
  }

  useEffect(() => {
    if (row.status === 'signed') void loadJobs();
    else setEmailLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  async function handleRequeue(onlyFailed: boolean) {
    if (busy) return;
    const hasJobs = (emailJobs?.length ?? 0) > 0;
    const action = !hasJobs
      ? '발송 작업이 없어요. 지금 생성하고 발송할까요?'
      : onlyFailed
        ? '실패한 발송만 재시도할까요?'
        : '모든 수신자에게 다시 발송할까요?';
    if (!confirm(action)) return;
    setBusy(true);
    try {
      let count = 0;
      if (!hasJobs) {
        // 0073 — jobs 0건 케이스: enqueue 부터 호출
        count = await adminEnqueueContractEmails(row.id);
        if (count === 0) {
          toast.warning('생성할 수신자가 없어요 (계약이 signed 상태가 아니거나 데이터 없음)');
        } else {
          toast.success(`${count}건 발송 큐 생성`);
        }
      } else {
        count = await adminRequeueContractEmails(row.id, onlyFailed);
        if (count === 0) {
          toast.info('재발송할 대상이 없어요');
        } else {
          toast.success(`${count}건 재발송 큐 등록`);
        }
      }
      if (count > 0) {
        const r = await dispatchContractEmails(row.id);
        if (r.ok) toast.success(`발송 완료 — 성공 ${r.sent ?? 0} · 실패 ${r.failed ?? 0}`);
        else toast.warning(r.error ?? '메일 발송 중 일부 실패');
      }
      await loadJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '재발송 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <FileText size={16} /> {row.contract_title}{' '}
            <span className="font-mono text-xs text-ink-mute">({row.contract_version})</span>
          </h3>
          <button onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Meta label="아티스트" value={row.artist_nickname || row.artist_email || row.artist_user_id.slice(0, 8)} />
            <Meta label="상태" value={STATUS_LABEL[row.status].label} />
            <Meta label="발행일" value={fmtDate(row.created_at)} />
            <Meta label="서명일" value={fmtDate(row.signed_at)} />
            <Meta label="서명 만료" value={fmtDate(row.expires_at)} />
          </div>
          {row.rejected_reason && (
            <Alert tone="error" title="거절 사유">{row.rejected_reason}</Alert>
          )}

          {row.status === 'signed' && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold">계약서 사본 메일 발송 상태</h4>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => void handleRequeue(true)}
                    disabled={busy || emailLoading}
                    className="rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-400/30 hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-200"
                  >
                    실패만 재발송
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRequeue(false)}
                    disabled={busy || emailLoading}
                    className="rounded-md bg-bg-card px-2 py-1 text-[11px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-50"
                  >
                    전체 재발송
                  </button>
                </div>
              </div>
              {emailErr && <Alert tone="error">{emailErr}</Alert>}
              {emailLoading ? (
                <p className="text-xs text-ink-mute">불러오는 중…</p>
              ) : emailJobs && emailJobs.length === 0 ? (
                <p className="text-xs text-ink-mute">발송 작업이 없어요.</p>
              ) : (
                emailJobs && (
                  <ul className="space-y-1 rounded-xl bg-bg-card p-2 ring-1 ring-line/10">
                    {emailJobs.map((j) => (
                      <li
                        key={j.job_id}
                        className="flex flex-wrap items-center gap-2 rounded-md bg-bg-soft p-2 text-[11px]"
                      >
                        <EmailJobBadge status={j.status} />
                        <span
                          className="rounded-full bg-bg-card px-1.5 py-0.5 text-[10px] font-semibold text-ink-mute ring-1 ring-line/10"
                          title={j.recipient_kind}
                        >
                          {j.recipient_kind === 'artist'
                            ? '본인'
                            : j.recipient_kind === 'admin'
                              ? 'admin'
                              : 'hardcoded'}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-mono">{j.recipient_email}</span>
                        <span className="text-ink-dim">{j.attempts}회 시도</span>
                        {j.sent_at && (
                          <span className="text-ink-dim">완료: {fmtDate(j.sent_at)}</span>
                        )}
                        {j.provider_message_id && (
                          <span
                            className="font-mono text-[10px] text-ink-dim"
                            title={j.provider_message_id}
                          >
                            id: {j.provider_message_id.slice(0, 8)}…
                          </span>
                        )}
                        {j.last_error && (
                          <p className="basis-full text-[10px] leading-snug text-red-700 dark:text-red-300">
                            {j.last_error}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              )}

              {emailEvents && emailEvents.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowEvents((v) => !v)}
                    className="text-[11px] font-semibold text-ink-mute hover:text-ink"
                  >
                    {showEvents ? '▼' : '▶'} 상태 전이 로그 ({emailEvents.length})
                  </button>
                  {showEvents && (
                    <ul className="mt-1 space-y-0.5 rounded-lg bg-bg-card p-2 text-[10px] ring-1 ring-line/10">
                      {emailEvents.map((e) => (
                        <li
                          key={e.event_id}
                          className="flex flex-wrap items-center gap-1.5 font-mono"
                        >
                          <span className="text-ink-dim">
                            {new Date(e.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                          </span>
                          <span className="text-ink">
                            {(e.from_status ?? '∅')} → {e.to_status}
                          </span>
                          <span className="text-ink-mute">{e.recipient_email}</span>
                          {e.attempts != null && (
                            <span className="text-ink-dim">attempts={e.attempts}</span>
                          )}
                          {e.error && (
                            <p className="basis-full pl-2 text-red-700 dark:text-red-300">
                              {e.error}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          <Alert tone="info">
            아티스트가 동의한 본문 자체는 사이즈가 크므로 상세 화면에는 표시하지 않습니다. 분쟁 시
            DB 의 contract_body 컬럼을 참조하세요 (immutable 스냅샷 보장).
          </Alert>
        </div>
      </div>
    </div>
  );
}

function DispatchHealthBanner({
  health,
  onRecheck,
}: {
  health: DispatchHealth | { ok: false; error: string } | null;
  onRecheck: () => void | Promise<void>;
}) {
  if (!health) {
    return (
      <Alert tone="info">
        메일 발송 환경 점검 중…
      </Alert>
    );
  }
  if (!('env' in health)) {
    // 호출 자체 실패 (네트워크 / 권한)
    return (
      <Alert tone="error" title="발송 환경 점검 실패">
        <p>{health.error}</p>
        <button
          type="button"
          onClick={() => void onRecheck()}
          className="mt-1 inline-flex rounded bg-bg-card px-2 py-0.5 text-[11px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
        >
          다시 점검
        </button>
      </Alert>
    );
  }
  const env = health.env;
  const keyDiag =
    env.resend_api_key_set
      ? `set · length=${env.resend_api_key_length ?? '?'} · ${env.resend_api_key_first4 ?? ''}…${env.resend_api_key_last4 ?? ''}`
      : 'MISSING';
  const inspect = env.env_inspect;
  const efDiag = (
    <p className="mt-1 text-[10px] text-ink-dim">
      EF instance loaded at <span className="font-mono">{env.module_load_at ?? '—'}</span>
      {env.supabase_url ? ` · project: ${env.supabase_url.replace(/^https:\/\//, '').split('.')[0]}` : ''}
    </p>
  );
  const inspectBlock = inspect ? (
    <details className="mt-2 rounded bg-bg-card px-2 py-1.5 text-[10px] text-ink-dim">
      <summary className="cursor-pointer select-none font-semibold text-ink-mute">
        runtime env 진단 — has_RESEND_API_KEY={String(inspect.has_RESEND_API_KEY)},
        has_RESEND_FROM={String(inspect.has_RESEND_FROM)},
        RESEND-like keys: [{inspect.resend_like_keys.join(', ') || '없음'}]
      </summary>
      <p className="mt-1.5 font-mono leading-snug break-all">
        env_keys ({inspect.all_keys.length}): {inspect.all_keys.join(', ')}
      </p>
    </details>
  ) : null;

  if (health.ready) {
    return (
      <Alert tone="success" title="메일 발송 준비 완료">
        <p>
          Resend FROM: <span className="font-mono">{env.resend_from}</span>
          {env.resend_from_is_fallback ? <span className="text-amber-700 dark:text-amber-300"> (fallback)</span> : null}
          {' · '}
          도메인:{' '}
          <span className="font-mono">
            {health.resend_domain.domain ?? '—'} ({health.resend_domain.status ?? '—'})
          </span>
          {' · '}
          KEY: <span className="font-mono">{keyDiag}</span>
        </p>
        {efDiag}
        {inspectBlock}
      </Alert>
    );
  }
  // 미준비
  const reasons: string[] = [];
  if (!env.resend_api_key_set) reasons.push('RESEND_API_KEY 미설정 (Edge Function runtime 에서 미인식)');
  if (
    env.resend_from_domain &&
    health.resend_domain.status &&
    health.resend_domain.status !== 'verified' &&
    health.resend_domain.status !== 'sandbox'
  ) {
    reasons.push(
      `FROM 도메인 ${env.resend_from_domain} verify 미완료 (status=${health.resend_domain.status})`,
    );
  }
  if (health.resend_domain.error) {
    reasons.push(`Resend API 오류: ${health.resend_domain.error}`);
  }
  return (
    <Alert tone="warning" title="메일 발송 환경 미준비 — 발송이 실패할 수 있어요">
      <ul className="ml-4 list-disc space-y-0.5">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
        {reasons.length === 0 && <li>알 수 없는 사유. Resend 상태를 확인하세요.</li>}
      </ul>
      <div className="mt-2 rounded bg-bg-card px-2 py-1.5 text-[10px] font-mono leading-relaxed text-ink-dim">
        FROM={env.resend_from}{env.resend_from_is_fallback ? ' (fallback)' : ''} · KEY={keyDiag}
        <br />
        domain={env.resend_from_domain ?? '—'} ({health.resend_domain.status ?? '—'})
        <br />
        supabase_url={env.supabase_url ?? '—'} · EF loaded at {env.module_load_at ?? '—'}
      </div>
      {inspectBlock}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onRecheck()}
          className="inline-flex rounded bg-bg-card px-2 py-1 text-[11px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
        >
          다시 점검
        </button>
        <span className="text-[11px] text-ink-mute">
          Supabase Edge Function secrets 에 RESEND_API_KEY / RESEND_FROM 을 설정한 뒤 다시 점검을 눌러주세요.
        </span>
      </div>
    </Alert>
  );
}

function EmailJobBadge({ status }: { status: ContractEmailJob['status'] }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200">
        <CheckCircle2 size={10} /> 발송
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-900 dark:bg-red-500/15 dark:text-red-200">
        <XCircle size={10} /> 실패
      </span>
    );
  }
  if (status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-200">
        진행
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <Clock size={10} /> 대기
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-dim">{hint}</span>}
    </label>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-card px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
