import { useEffect, useState } from 'react';
import { Plus, X, RefreshCw, Pencil, Eye, Power } from 'lucide-react';
import {
  fetchSalesAgentList,
  fetchSalesAgentDetail,
  upsertSalesAgent,
  generateSalesAgentCode,
  type SalesAgentListRow,
  type SalesAgentDetail,
} from '@/lib/salesAgentApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

function fmtKrw(n: number): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function currentKstMonth(): string {
  // KST 기준 이번 달 1일 (YYYY-MM-01) — input[type=month] 호환 (YYYY-MM)
  // KST = UTC+9 — 임의의 now() 가 같은 KST 월에 속함을 단순히 계산
  const now = new Date();
  // toLocaleDateString 으로 KST date 추출
  const yyyy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(now);
  const mm = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit' }).format(now);
  return `${yyyy}-${mm}`;
}

export default function SalesAgentsList() {
  const [rows, setRows] = useState<SalesAgentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<SalesAgentListRow | 'new' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // X6.30 — 월 선택 (YYYY-MM, KST)
  const [monthInput, setMonthInput] = useState<string>(currentKstMonth());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSalesAgentList(`${monthInput}-01`);
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
  }, [monthInput]);

  async function toggleActive(row: SalesAgentListRow) {
    try {
      await upsertSalesAgent({ id: row.id, is_active: !row.is_active });
      toast.success(row.is_active ? '비활성화됐어요.' : '활성화됐어요.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '변경 실패');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">영업인 관리</h2>
          <p className="text-xs text-ink-mute">
            {rows.length}명 · 사업자 가입 시 영업인 코드로 유입 추적
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* X6.30: KST 월 선택 — 누적 컬럼은 무관, 이번 달 컬럼만 영향 */}
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-mute">
            <span>대상 월 (KST)</span>
            <input
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value || currentKstMonth())}
              className="input w-auto text-sm"
            />
            {monthInput !== currentKstMonth() && (
              <button
                type="button"
                onClick={() => setMonthInput(currentKstMonth())}
                className="text-[10px] font-semibold text-accent hover:underline"
                title="이번 달로 초기화"
              >
                초기화
              </button>
            )}
          </label>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
          >
            <RefreshCw size={12} /> 새로고침
          </button>
          <button
            onClick={() => setEditTarget('new')}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/90"
          >
            <Plus size={12} /> 영업인 추가
          </button>
        </div>
      </div>

      {error && (
        <Alert tone="error" title="영업인 목록 조회 실패">
          <pre className="whitespace-pre-wrap break-all text-[11px]">{error}</pre>
          <p className="mt-1 text-[11px] opacity-80">
            0054_sales_agents.sql 마이그레이션이 적용됐는지 확인해주세요.
          </p>
        </Alert>
      )}

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="px-3 py-2.5 text-left font-semibold">영업인</th>
                <th className="px-3 py-2.5 text-left font-semibold">코드</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-right font-semibold">유입 사업자</th>
                <th className="px-3 py-2.5 text-right font-semibold">결제 완료</th>
                <th className="px-3 py-2.5 text-right font-semibold">누적 결제</th>
                <th className="px-3 py-2.5 text-right font-semibold">수수료율</th>
                <th className="px-3 py-2.5 text-right font-semibold">누적 정산액</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  {monthInput} 결제
                  <span className="ml-1 text-[9px] font-normal text-ink-dim">(건수)</span>
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">{monthInput} 정산액</th>
                <th className="px-3 py-2.5 text-right font-semibold">생성</th>
                <th className="px-3 py-2.5 text-right font-semibold">최근 활동</th>
                <th className="w-px px-3 py-2.5 text-right font-semibold">관리</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-xs text-ink-mute">
                    등록된 영업인이 없어요. 우측 상단에서 추가해주세요.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/10 hover:bg-bg-hover">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-ink-mute">{r.email ?? '—'}</p>
                    <p className="text-xs text-ink-mute">{r.phone ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="rounded bg-bg-soft px-2 py-0.5 font-mono text-xs">{r.code}</code>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.is_active ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        활성
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink-dim">
                        비활성
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.linked_business_count}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.paid_business_count}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtKrw(r.total_paid_amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.commission_rate}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtKrw(r.total_commission_amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span>{fmtKrw(r.monthly_paid_amount)}</span>
                    {r.monthly_paid_count > 0 && (
                      <span className="ml-1 text-[10px] text-ink-dim">({r.monthly_paid_count}건)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-accent">
                    {fmtKrw(r.monthly_commission_amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                    {fmtDate(r.created_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                    {fmtDate(r.last_activity_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setDetailId(r.id)}
                        className="rounded p-1.5 hover:bg-ink/5"
                        title="상세"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => setEditTarget(r)}
                        className="rounded p-1.5 hover:bg-ink/5"
                        title="수정"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => void toggleActive(r)}
                        className="rounded p-1.5 hover:bg-ink/5"
                        title={r.is_active ? '비활성화' : '활성화'}
                      >
                        <Power size={14} className={r.is_active ? 'text-emerald-300' : 'text-ink-dim'} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editTarget && (
        <SalesAgentEditor
          initial={editTarget === 'new' ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void load();
          }}
        />
      )}

      {detailId && (
        <SalesAgentDetailModal
          id={detailId}
          month={`${monthInput}-01`}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ============================================
// 생성/수정 모달
// ============================================
function SalesAgentEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: SalesAgentListRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = initial === null;
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [commissionRate, setCommissionRate] = useState<string>(
    initial ? String(initial.commission_rate) : '0',
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateCode() {
    try {
      const c = await generateSalesAgentCode();
      setCode(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '코드 생성 실패');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('이름을 입력해주세요.');
      return;
    }
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError('수수료율은 0 ~ 100 사이여야 해요.');
      return;
    }
    setBusy(true);
    try {
      await upsertSalesAgent({
        id: initial?.id ?? null,
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        code: code.trim() || null,
        commission_rate: rate,
        is_active: isActive,
      });
      toast.success(isNew ? '영업인이 추가됐어요.' : '저장됐어요.');
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장 실패';
      // 23505 → 중복 코드
      if (msg.includes('duplicate')) {
        setError('이미 사용 중인 영업인 코드예요. 다른 코드를 입력하거나 자동 생성을 눌러주세요.');
      } else {
        setError(msg);
      }
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
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h2 className="text-base font-bold">{isNew ? '영업인 추가' : '영업인 수정'}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          <Field label="이름 *">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="이메일">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="전화번호">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
              placeholder="010-0000-0000"
            />
          </Field>
          <Field label="영업인 코드" hint="비워두고 저장하면 자동 생성됩니다. 중복 불가.">
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="input flex-1 font-mono"
                placeholder="자동 생성하려면 비워두세요"
                autoCapitalize="characters"
              />
              <button
                type="button"
                onClick={handleGenerateCode}
                className="rounded-lg bg-accent/15 px-3 text-xs font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20"
              >
                자동 생성
              </button>
            </div>
          </Field>
          <Field label="수수료율 (%)">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="input"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>활성</span>
          </label>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-bg-card py-2 text-sm font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-black hover:bg-accent/90 disabled:opacity-60"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// 상세 모달 — 연결된 사업자 + 결제 리스트
// ============================================
function SalesAgentDetailModal({
  id,
  month,
  onClose,
}: {
  id: string;
  // X6.30: list 와 동일 월을 따라가도록 prop 전달
  month: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<SalesAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSalesAgentDetail(id, month)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, month]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h2 className="text-base font-bold">영업인 상세</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-ink-mute">불러오는 중…</div>
        ) : error || !data ? (
          <div className="space-y-3 p-6">
            <p className="text-sm font-bold text-red-300">조회 실패</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg-soft p-3 text-[11px] text-ink-mute">
              {error ?? '데이터가 없어요.'}
            </pre>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <section className="space-y-2">
              <div className="flex items-baseline gap-3">
                <h3 className="text-lg font-bold">{data.agent.name}</h3>
                <code className="rounded bg-bg-soft px-2 py-0.5 font-mono text-xs">{data.agent.code}</code>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    data.agent.is_active
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-ink/10 text-ink-dim'
                  }`}
                >
                  {data.agent.is_active ? '활성' : '비활성'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KV label="이메일" value={data.agent.email ?? '—'} />
                <KV label="전화" value={data.agent.phone ?? '—'} />
                <KV label="수수료율" value={`${data.agent.commission_rate}%`} />
                <KV label="등록일" value={fmtDate(data.agent.created_at)} />
              </div>
            </section>

            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="유입 사업자" value={String(data.summary.linked_business_count)} />
              <Stat label="결제 완료" value={String(data.summary.paid_business_count)} />
              <Stat label="누적 결제" value={fmtKrw(data.summary.total_paid_amount)} />
              <Stat label="누적 정산액" value={fmtKrw(data.summary.total_commission_amount)} />
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">
                이번 달 정산 (KST 기준)
              </h4>
              <div className="grid grid-cols-3 gap-2">
                <Stat
                  label="이번 달 결제"
                  value={fmtKrw(data.summary.monthly_paid_amount)}
                />
                <Stat
                  label="이번 달 결제 건수"
                  value={`${data.summary.monthly_paid_count}건`}
                />
                <Stat
                  label="이번 달 정산액"
                  value={fmtKrw(data.summary.monthly_commission_amount)}
                  emphasize
                />
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">
                연결된 사업자 ({data.businesses.length})
              </h4>
              <div className="overflow-hidden rounded-xl bg-bg-card ring-1 ring-line/10">
                {data.businesses.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-ink-dim">연결된 사업자가 없어요</p>
                ) : (
                  data.businesses.map((b) => (
                    <div
                      key={b.user_id}
                      className="flex items-start justify-between gap-3 border-t border-line/10 px-3 py-2 first:border-t-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {b.store_name || b.full_name || b.nickname || '이름없음'}
                        </p>
                        <p className="truncate text-xs text-ink-mute">{b.email ?? '—'}</p>
                        <p className="text-xs text-ink-dim">
                          {b.business_number ?? '—'} · {b.membership_tier ?? b.subscription_type ?? '—'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-dim">{fmtDate(b.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">
                결제 내역 ({data.payments.length})
              </h4>
              <div className="overflow-hidden rounded-xl bg-bg-card ring-1 ring-line/10">
                {data.payments.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-ink-dim">결제 내역이 없어요</p>
                ) : (
                  data.payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start justify-between gap-3 border-t border-line/10 px-3 py-2 first:border-t-0"
                    >
                      <div>
                        <p className="text-sm font-semibold">{fmtKrw(p.amount)}</p>
                        <p className="text-xs text-ink-mute">
                          {p.plan_type} · {p.status}
                        </p>
                        <p className="font-mono text-[10px] text-ink-dim">{p.order_no}</p>
                      </div>
                      <span className="text-xs text-ink-dim">
                        {fmtDate(p.paid_at ?? p.created_at)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// 공용 작은 컴포넌트
// ============================================
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-dim">{hint}</span>}
    </label>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-card px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div
      className={`rounded-xl px-3 py-2.5 ${
        emphasize ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-bg-card'
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <p
        className={`mt-1 text-base font-extrabold tabular-nums ${emphasize ? 'text-accent' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}
