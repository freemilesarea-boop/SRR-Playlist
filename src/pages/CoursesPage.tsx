import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, GraduationCap, Loader2, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { fetchActiveCourseProducts, createCoursePayment, type ActiveCourseProduct } from '@/lib/courseApi';
import { formatKRW, normalizePhone, seatLabel } from '@/lib/courseProduct';

export default function CoursesPage() {
  const [products, setProducts] = useState<ActiveCourseProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ActiveCourseProduct | null>(null);

  useEffect(() => {
    (async () => {
      try { setProducts(await fetchActiveCourseProducts()); }
      catch (e) { toast.error(friendlyError(e, '수강 상품을 불러오지 못했어요')); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink">
        <ArrowLeft size={14} /> 홈으로
      </Link>
      <div className="mb-5 flex items-center gap-2">
        <GraduationCap size={22} className="text-ink" />
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">수강신청</h1>
          <p className="text-xs text-ink-mute">원하는 수업을 선택하고 결제하면 신청이 완료돼요.</p>
        </div>
      </div>

      {loading ? (
        <p className="p-8 text-center text-sm text-ink-mute"><Loader2 size={18} className="mx-auto animate-spin" /></p>
      ) : products.length === 0 ? (
        <div className="rounded-2xl bg-bg-card p-10 text-center ring-1 ring-line/10">
          <GraduationCap size={28} className="mx-auto text-ink-dim" />
          <p className="mt-2 text-sm text-ink-mute">현재 신청 가능한 수업이 없어요.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const soldOut = p.remaining != null && p.remaining <= 0;
            return (
              <div key={p.id} className="flex flex-col rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
                {p.category && <span className="mb-1 text-[11px] font-semibold text-ink-mute">{p.category}</span>}
                <h2 className="text-base font-bold text-ink">{p.name}</h2>
                <p className="mt-1 flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-mute">{p.description}</p>
                <div className="mt-3 flex items-center justify-between border-t border-line/10 pt-3">
                  <div>
                    <p className="text-lg font-extrabold text-ink">{formatKRW(p.price)}</p>
                    <p className="text-[11px] text-ink-dim">{seatLabel(p.remaining, p.sold)}</p>
                  </div>
                  <button
                    disabled={soldOut}
                    onClick={() => setSelected(p)}
                    className="rounded-full bg-ink px-4 py-2 text-xs font-bold text-bg-base transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {soldOut ? '마감' : '신청하기'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && <EnrollModal product={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EnrollModal({ product, onClose }: { product: ActiveCourseProduct; onClose: () => void }) {
  const { profile, user } = useAuthStore();
  const [phone, setPhone] = useState<string>((profile as { phone?: string } | null)?.phone ?? '');
  const [name, setName] = useState<string>(profile?.nickname ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function pay() {
    const digits = normalizePhone(phone);
    if (digits.length < 9) { toast.error('연락처를 정확히 입력해주세요.'); return; }
    setSubmitting(true);
    try {
      const res = await createCoursePayment({ productId: product.id, recvphone: digits, buyerName: name.trim() });
      if (res.ok && res.payurl) {
        window.location.href = res.payurl; // PayApp 결제창으로 이동
        return;
      }
      toast.error(res.reason || res.error || '결제를 시작하지 못했어요.');
    } catch (e) {
      toast.error(friendlyError(e, '결제 시작 실패'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-bg-card p-5 ring-1 ring-line/15 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-ink">{product.name}</h3>
            <p className="text-sm font-extrabold text-ink">{formatKRW(product.price)}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-mute hover:text-ink"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-mute">신청자 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름"
              className="w-full rounded-lg bg-bg-base px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-mute">연락처</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" inputMode="numeric"
              className="w-full rounded-lg bg-bg-base px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
          </label>
          <p className="text-[11px] text-ink-dim">
            결제 확인 메일은 {user?.email ?? '가입 이메일'}로 발송돼요. 결제 완료 시 신청이 확정됩니다.
          </p>
          <button onClick={pay} disabled={submitting}
            className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-bg-base transition hover:opacity-90 disabled:opacity-50">
            {submitting ? <Loader2 size={16} className="mx-auto animate-spin" /> : `${formatKRW(product.price)} 결제하기`}
          </button>
        </div>
      </div>
    </div>
  );
}
