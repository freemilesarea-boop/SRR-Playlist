import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Plus, Pencil, Trash2, Eye, EyeOff, Users, Loader2 } from 'lucide-react';
import { AdminCard, AdminSection, AdminButton, AdminBadge, AdminModal, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import {
  adminListCourseProducts, adminCreateCourseProduct, adminUpdateCourseProduct,
  adminSetCourseProductActive, adminDeleteCourseProduct, adminListCourseEnrollments,
  type AdminCourseProduct, type CourseEnrollment,
} from '@/lib/courseApi';
import {
  formatKRW, validateCourseProductForm, courseFormToParams, seatLabel,
  COURSE_ORDER_STATUS_LABEL, COURSE_ORDER_STATUS_TONE,
  type CourseProductForm, type CourseOrderStatus,
} from '@/lib/courseProduct';

type SubTab = 'products' | 'enrollments';

export default function CourseProductsPanel() {
  const [sub, setSub] = useState<SubTab>('products');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GraduationCap size={18} className="text-ink" />
        <div>
          <h2 className="text-lg font-bold tracking-tight">수강신청 상품</h2>
          <p className="text-xs text-ink-mute">상품을 만들고 신청·결제 내역을 관리합니다.</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        {([['products', '상품 관리', <GraduationCap size={13} key="p" />],
          ['enrollments', '신청 내역', <Users size={13} key="e" />]] as const).map(([k, label, icon]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              sub === k ? 'bg-bg-hover text-ink' : 'text-ink-mute hover:text-ink'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {sub === 'products' ? <ProductsTab /> : <EnrollmentsTab />}
    </div>
  );
}

const EMPTY_FORM: CourseProductForm = { name: '', description: '', category: '', price: '', capacity: '', sortOrder: '' };

function ProductsTab() {
  const [rows, setRows] = useState<AdminCourseProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminCourseProduct | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminListCourseProducts()); }
    catch (e) { toast.error(friendlyError(e, '상품 목록 실패')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggleActive(p: AdminCourseProduct) {
    try { await adminSetCourseProductActive(p.id, !p.is_active); load(); }
    catch (e) { toast.error(friendlyError(e, '상태 변경 실패')); }
  }
  async function remove(p: AdminCourseProduct) {
    if (!window.confirm(`"${p.name}" 상품을 삭제할까요?`)) return;
    try { await adminDeleteCourseProduct(p.id); toast.success('삭제했어요.'); load(); }
    catch (e) { toast.error(friendlyError(e, '삭제 실패')); }
  }

  return (
    <>
      <AdminSection title="상품 목록"
        action={<AdminButton tone="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>상품 추가</AdminButton>}>
        {loading ? (
          <p className="p-6 text-sm text-ink-mute">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <AdminEmpty icon={<GraduationCap size={26} />} title="상품이 없어요" description="첫 수강 상품을 만들어보세요."
            action={<AdminButton tone="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>상품 추가</AdminButton>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((p) => (
              <AdminCard key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AdminBadge tone={p.is_active ? 'success' : 'neutral'} size="sm">{p.is_active ? '판매중' : '숨김'}</AdminBadge>
                      {p.category && <span className="text-[11px] text-ink-dim">{p.category}</span>}
                    </div>
                    <p className="mt-1 truncate text-sm font-bold text-ink">{p.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-mute">{p.description || '—'}</p>
                  </div>
                  <p className="shrink-0 text-sm font-extrabold text-ink">{formatKRW(p.price)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-line/10 pt-2">
                  <span className="text-[11px] text-ink-dim">
                    {seatLabel(p.capacity == null ? null : Math.max(0, p.capacity - p.paid_count), p.paid_count)}
                    {' · '}매출 {formatKRW(p.revenue)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleActive(p)} title={p.is_active ? '숨기기' : '판매'} className="rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink">
                      {p.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => setEditing(p)} title="수정" className="rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink"><Pencil size={14} /></button>
                    <button onClick={() => remove(p)} title="삭제" className="rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink"><Trash2 size={14} /></button>
                  </div>
                </div>
              </AdminCard>
            ))}
          </div>
        )}
      </AdminSection>

      {(creating || editing) && (
        <ProductFormModal
          product={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function ProductFormModal({ product, onClose, onSaved }: { product: AdminCourseProduct | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CourseProductForm>(product ? {
    name: product.name, description: product.description, category: product.category ?? '',
    price: product.price, capacity: product.capacity ?? '', sortOrder: product.sort_order,
  } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const validation = validateCourseProductForm(form);

  async function save() {
    setSaving(true);
    try {
      const params = courseFormToParams(form);
      if (product) { await adminUpdateCourseProduct(product.id, params); toast.success('수정했어요.'); }
      else { await adminCreateCourseProduct(params); toast.success('상품을 추가했어요.'); }
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e, '저장 실패'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminModal open onClose={onClose} title={product ? '상품 수정' : '상품 추가'} size="md"
      footer={<>
        <AdminButton tone="neutral" variant="ghost" onClick={onClose} disabled={saving}>취소</AdminButton>
        <AdminButton tone="primary" onClick={save} disabled={!validation.ok || saving}
          leftIcon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}>저장</AdminButton>
      </>}>
      <div className="space-y-3">
        <Field label="상품명">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
        </Field>
        <Field label="설명">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="h-24 w-full resize-y rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="카테고리 (선택)">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="예: 보컬"
              className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
          </Field>
          <Field label="가격 (원)">
            <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="50000"
              className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
          </Field>
          <Field label="정원 (비우면 무제한)">
            <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="무제한"
              className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
          </Field>
          <Field label="정렬 순서">
            <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} placeholder="0"
              className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40" />
          </Field>
        </div>
        {!validation.ok && <p className="text-[11px] text-ink-mute">{validation.errors.join(' ')}</p>}
      </div>
    </AdminModal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink-mute">{label}</span>
      {children}
    </label>
  );
}

function EnrollmentsTab() {
  const [rows, setRows] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminListCourseEnrollments(null, 300, 0)); }
    catch (e) { toast.error(friendlyError(e, '신청 내역 실패')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const paidCount = rows.filter((r) => r.status === 'paid').length;
  const revenue = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);

  if (loading) return <p className="p-6 text-sm text-ink-mute">불러오는 중…</p>;

  return (
    <AdminSection title="신청 내역"
      description={`결제 완료 ${paidCount.toLocaleString('ko-KR')}건 · 매출 ${formatKRW(revenue)}`}
      action={<AdminButton tone="neutral" variant="ghost" size="sm" onClick={load}>새로고침</AdminButton>}>
      {rows.length === 0 ? (
        <AdminEmpty icon={<Users size={26} />} title="신청 내역이 없어요" />
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-line/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line/10 text-[11px] text-ink-dim">
              <tr>
                <th className="px-3 py-2 font-semibold">상품</th>
                <th className="px-3 py-2 font-semibold">신청자</th>
                <th className="px-3 py-2 font-semibold">금액</th>
                <th className="px-3 py-2 font-semibold">상태</th>
                <th className="px-3 py-2 font-semibold">일시</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order_id} className="border-t border-line/10">
                  <td className="max-w-[180px] truncate px-3 py-2 text-ink">{r.product_name}</td>
                  <td className="px-3 py-2">
                    <span className="block truncate text-ink">{r.nickname || '—'}</span>
                    <span className="block truncate text-[11px] text-ink-dim">{r.email}</span>
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums text-ink">{formatKRW(r.amount)}</td>
                  <td className="px-3 py-2">
                    <AdminBadge tone={COURSE_ORDER_STATUS_TONE[r.status as CourseOrderStatus]} size="sm">
                      {COURSE_ORDER_STATUS_LABEL[r.status as CourseOrderStatus]}
                    </AdminBadge>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-ink-dim">{new Date(r.paid_at || r.created_at).toLocaleString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  );
}
