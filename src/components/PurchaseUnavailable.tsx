/**
 * PurchaseUnavailable — 앱에서 결제 화면에 들어왔을 때 대신 보여주는 화면.
 *
 * 왜 링크나 연락처를 두지 않나: 구글/애플 정책이 금지하는 것이 "앱 안에서
 * 외부 결제로 유도하는 것" 이라, 결제할 수 있는 다른 곳을 안내하는 것 자체가
 * 반려 사유가 된다. 그래서 상태만 알리고 끝낸다. (purchaseGate.ts 참고)
 */
import { CreditCard } from 'lucide-react';
import { PURCHASE_UNAVAILABLE_TITLE, PURCHASE_UNAVAILABLE_BODY } from '@/lib/purchaseGate';

export default function PurchaseUnavailable() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <CreditCard size={28} />
      </span>
      <div>
        <h1 className="text-lg font-extrabold tracking-tight">{PURCHASE_UNAVAILABLE_TITLE}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-mute">{PURCHASE_UNAVAILABLE_BODY}</p>
      </div>
    </div>
  );
}
