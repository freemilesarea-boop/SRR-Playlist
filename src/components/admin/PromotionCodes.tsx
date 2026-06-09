import { useEffect, useState } from 'react';
import { Plus, X, RefreshCw, Power, Trash2 } from 'lucide-react';
import {
  adminListPromotionCodes,
  adminCreatePromotionCode,
  adminSetPromotionActive,
  adminDeletePromotionCode,
  type PromotionCodeRow,
} from '@/lib/adminApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

const PLAN_LABEL: Record<string, string> = {
  individual: '일반',
  business: '사업자',
  all: '전체',
};

function discountLabel(r: PromotionCodeRow): string {
  return r.discount_type === 'percent'
    ? `${r.discount_amount}%`
    : `${r.discount_amount.toLocaleString()}원`;
}

export default function PromotionCodes() {
  const [rows, setRows] = useState<PromotionCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminListPromotionCodes());
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(r: PromotionCodeRow) {
    try {
      await adminSetPromotionActive(r.id, !r.is_active);
      toast.success(r.is_active ? '비활성화됐어요.' : '활성화됐어요.');
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '변경 실패'));
    }
  }

  async function remove(r: PromotionCodeRow) {
    if (!window.confirm(`'${r.code}' 코드를 삭제할까요?\n이미 적용된 구독은 그대로 유지되고, 신규 적용만 차단됩니다.`)) return;
    try {
      await adminDeletePromotionCode(r.id);
      toast.success('삭제됐어요.');
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '삭제 실패'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">프로모션 코드</h2>
          <p className="text-xs text-ink-mute">
            {rows.length}개 · 가입/결제 시 할인 코드. 사용 횟수 무제한, 여러 회원 재사용 가능
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
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/90"
          >
            <Plus size={12} /> 코드 추가
          </button>
        </div>
      </div>

      {error && (
        <Alert tone="error" title="프로모션 코드 조회 실패">
          <pre className="whitespace-pre-wrap break-all text-[11px]">{error}</pre>
          <p className="mt-1 text-[11px] opacity-80">
            0104_promotion_codes.sql 마이그레이션이 적용됐는지 확인해주세요.
          </p>
        </Alert>
      )}

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="px-3 py-2.5 text-left font-semibold">코드</th>
                <th className="px-3 py-2.5 text-left font-semibold">대상</th>
                <th className="px-3 py-2.5 text-right font-semibold">할인</th>
                <th className="px-3 py-2.5 text-left font-semibold">기간</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-right font-semibold">사용 / 제한</th>
                <th className="px-3 py-2.5 text-right font-semibold">누적 할인</th>
                <th className="w-px px-3 py-2.5 text-right font-semibold">관리</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-ink-mute">불러오는 중…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-ink-mute">
                    등록된 프로모션 코드가 없어요. 우측 상단에서 추가해주세요.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const deleted = !!r.deleted_at;
                return (
                  <tr key={r.id} className={`border-b border-line/10 hover:bg-bg-hover ${deleted ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <code className="rounded bg-bg-soft px-2 py-0.5 font-mono text-xs font-bold">{r.code}</code>
                      {r.name && <p className="mt-0.5 text-xs text-ink-mute">{r.name}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{PLAN_LABEL[r.target_plan] ?? r.target_plan}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{discountLabel(r)}</td>
                    <td className="px-3 py-2.5 text-xs text-ink-mute">
                      {fmtDate(r.starts_at)} ~ {fmtDate(r.ends_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      {deleted ? (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">삭제됨</span>
                      ) : r.is_active ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">활성</span>
                      ) : (
                        <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink-dim">비활성</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.max_redemptions != null ? (
                        <span className={r.redemption_count >= r.max_redemptions ? 'font-semibold text-red-300' : ''}>
                          {r.redemption_count} / {r.max_redemptions}
                        </span>
                      ) : (
                        <span>{r.redemption_count} / <span className="text-ink-dim">무제한</span></span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{(r.total_discount ?? 0).toLocaleString()}원</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {!deleted && (
                          <>
                            <button onClick={() => void toggle(r)} className="rounded p-1.5 hover:bg-ink/5" title={r.is_active ? '비활성화' : '활성화'}>
                              <Power size={14} className={r.is_active ? 'text-emerald-300' : 'text-ink-dim'} />
                            </button>
                            <button onClick={() => void remove(r)} className="rounded p-1.5 hover:bg-red-500/10" title="삭제">
                              <Trash2 size={14} className="text-red-300" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreatePromotionModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreatePromotionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [targetPlan, setTargetPlan] = useState<'individual' | 'business' | 'all'>('all');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountAmount, setDiscountAmount] = useState('2000');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError('코드를 입력해주세요.');
      return;
    }
    const amt = Number(discountAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('할인 금액/비율을 올바르게 입력해주세요.');
      return;
    }
    let maxR: number | null = null;
    if (maxRedemptions.trim()) {
      const m = Number(maxRedemptions);
      if (!Number.isFinite(m) || m <= 0) {
        setError('선착순 제한은 1 이상의 숫자여야 해요. (무제한은 비워두세요)');
        return;
      }
      maxR = Math.round(m);
    }
    setBusy(true);
    try {
      await adminCreatePromotionCode({
        code: code.trim(),
        name: name.trim() || null,
        target_plan: targetPlan,
        discount_type: discountType,
        discount_amount: Math.round(amt),
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        note: note.trim() || null,
        max_redemptions: maxR,
      });
      toast.success('프로모션 코드가 생성됐어요.');
      onSaved();
    } catch (err) {
      const msg = friendlyError(err, '생성 실패');
      setError(msg.includes('duplicate') ? '이미 사용 중인 코드예요.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h2 className="text-base font-bold">프로모션 코드 추가</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          <Field label="코드 *" hint="대문자 영문/숫자 권장 (예: OPEN2000)">
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="input font-mono"
              placeholder="OPEN2000"
              autoCapitalize="characters"
            />
          </Field>
          <Field label="이름/설명">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="오픈 기념 할인" />
          </Field>
          <Field label="대상 요금제">
            <select value={targetPlan} onChange={(e) => setTargetPlan(e.target.value as typeof targetPlan)} className="input">
              <option value="all">전체</option>
              <option value="individual">일반</option>
              <option value="business">사업자</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="할인 방식">
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)} className="input">
                <option value="fixed">정액 (원)</option>
                <option value="percent">정률 (%)</option>
              </select>
            </Field>
            <Field label={discountType === 'percent' ? '할인율 (%)' : '할인액 (원)'}>
              <input type="number" min={0} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} className="input" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일" hint="비우면 즉시">
              <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input" />
            </Field>
            <Field label="종료일" hint="비우면 무기한">
              <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="input" />
            </Field>
          </div>
          <Field label="선착순 제한" hint="비워두면 무제한. 도달 시 신규 적용 차단.">
            <input
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              className="input"
              placeholder="예: 100"
            />
          </Field>
          <Field label="메모">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </Field>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-bg-card py-2 text-sm font-semibold ring-1 ring-line/10 hover:bg-bg-hover">
              취소
            </button>
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-black hover:bg-accent/90 disabled:opacity-60">
              {busy ? '생성 중…' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
