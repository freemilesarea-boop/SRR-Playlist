import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminModal, AdminButton, AdminAlert } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import {
  adminGetEnterpriseBillingConfig, adminSetEnterpriseBillingConfig,
} from '@/lib/enterprisePaymentApi';
import {
  BILLING_MODE_LABEL, validateBillingConfig, billingConfigToParams,
  type EnterpriseBillingMode, type BillingConfigForm,
} from '@/lib/enterprisePayment';

export default function EnterpriseBillingConfigModal({
  enterpriseAccountId, enterpriseName, onClose,
}: { enterpriseAccountId: string; enterpriseName: string; onClose: () => void }) {
  const [form, setForm] = useState<BillingConfigForm>({
    billingEnabled: false, billingMode: 'hq_consolidated', hqMonthlyPrice: '', storeMonthlyPrice: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSubs, setActiveSubs] = useState<{ hq: number; store: number }>({ hq: 0, store: 0 });

  useEffect(() => {
    (async () => {
      try {
        const cfg = await adminGetEnterpriseBillingConfig(enterpriseAccountId);
        if (cfg) {
          setForm({
            billingEnabled: cfg.billing_enabled,
            billingMode: cfg.billing_mode,
            hqMonthlyPrice: cfg.hq_monthly_price ?? '',
            storeMonthlyPrice: cfg.store_monthly_price ?? '',
          });
          setActiveSubs({ hq: cfg.active_hq_subs, store: cfg.active_store_subs });
        }
      } catch (e) { toast.error(friendlyError(e, '청구 설정을 불러오지 못했어요')); }
      finally { setLoading(false); }
    })();
  }, [enterpriseAccountId]);

  const validation = validateBillingConfig(form);

  async function save() {
    setSaving(true);
    try {
      await adminSetEnterpriseBillingConfig(enterpriseAccountId, billingConfigToParams(form));
      toast.success('청구 설정을 저장했어요.');
      onClose();
    } catch (e) {
      toast.error(friendlyError(e, '저장 실패'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminModal open onClose={onClose} title={`청구 설정 · ${enterpriseName}`} size="md"
      footer={<>
        <AdminButton tone="neutral" variant="ghost" onClick={onClose} disabled={saving}>취소</AdminButton>
        <AdminButton tone="primary" onClick={save} disabled={!validation.ok || saving}
          leftIcon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}>저장</AdminButton>
      </>}>
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-mute"><Loader2 size={18} className="mx-auto animate-spin" /></p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.billingEnabled} onChange={(e) => setForm({ ...form, billingEnabled: e.target.checked })} />
            가입 후 정기결제 사용
          </label>

          <div>
            <span className="mb-1 block text-xs font-semibold text-ink-mute">청구 방식</span>
            <div className="grid grid-cols-2 gap-2">
              {(['hq_consolidated', 'per_store'] as EnterpriseBillingMode[]).map((m) => (
                <button key={m} onClick={() => setForm({ ...form, billingMode: m })}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ring-1 transition ${
                    form.billingMode === m ? 'bg-bg-hover text-ink ring-line/30' : 'bg-bg-card text-ink-mute ring-line/10 hover:text-ink'}`}>
                  {BILLING_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-dim">
              {form.billingMode === 'hq_consolidated'
                ? '본사(HQ) 담당자가 정액 월요금을 결제합니다. 매장은 결제하지 않습니다.'
                : '각 가맹점(매장)이 가입 후 정액 월요금을 결제합니다. 본사는 결제하지 않습니다.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-mute">본사 월요금 (원)</span>
              <input type="number" value={form.hqMonthlyPrice} onChange={(e) => setForm({ ...form, hqMonthlyPrice: e.target.value })}
                disabled={form.billingMode !== 'hq_consolidated'} placeholder="예: 99000"
                className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40 disabled:opacity-40" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-mute">매장 월요금 (원)</span>
              <input type="number" value={form.storeMonthlyPrice} onChange={(e) => setForm({ ...form, storeMonthlyPrice: e.target.value })}
                disabled={form.billingMode !== 'per_store'} placeholder="예: 4900"
                className="w-full rounded-lg bg-bg-card px-3 py-2 text-sm text-ink ring-1 ring-line/15 focus:ring-line/40 disabled:opacity-40" />
            </label>
          </div>

          {(activeSubs.hq > 0 || activeSubs.store > 0) && (
            <AdminAlert tone="info" description={`활성 정기결제 — 본사 ${activeSubs.hq}건 · 매장 ${activeSubs.store}건`} />
          )}
          {!validation.ok && <p className="text-[11px] text-ink-mute">{validation.errors.join(' ')}</p>}
        </div>
      )}
    </AdminModal>
  );
}
