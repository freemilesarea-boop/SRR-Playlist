// Brand Player 진입 — 매장 코드(Store Invite Code) 입력 페이지 (/brand).
// 매장은 본사에서 받은 매장 코드만 입력 → 본사 조회 → 연결 브랜드 플레이어로 진입.
// (사용자 입력 "브랜드 코드"는 사용하지 않음. 브랜드는 관리자 내부 객체.)
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tag, ArrowRight, Loader2, KeyRound, Clock } from 'lucide-react';
import { verifyStoreCode } from '@/lib/api/brandPlayerApi';
import { saveBrandToken, pushRecentBrand, getRecentBrands, getBrandToken } from '@/lib/brandSession';
import { STORE_VERIFY_ERROR_MESSAGES } from '@/types/brand';

interface BrandNavState { fromPlayerReject?: boolean; deviceRevoked?: boolean; switchStore?: boolean; reason?: string }

export default function BrandPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? null) as BrandNavState | null;
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recent = getRecentBrands();
  const autoTriedRef = useRef(false);

  // BRAND-DEVICE-BINDING-1: 재방문 자동 진입.
  // 저장된 binding 이 있으면 플레이어로 진입(플레이어가 서버 재검증). 단, 플레이어가 거부/해제/전환으로
  // 돌려보낸 경우에는 자동 진입하지 않는다(무한 루프 방지) — 코드 입력을 요구한다.
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (navState?.fromPlayerReject || navState?.deviceRevoked || navState?.switchStore) {
      if (navState.deviceRevoked) setNotice('이 기기의 매장 연결이 해제되었습니다.');
      else if (navState.reason === 'expired') setNotice('매장 연결이 만료되었습니다. 매장 코드를 다시 입력해 주세요.');
      else if (navState.reason === 'revoked') setNotice('이 기기의 매장 연결이 해제되었습니다.');
      return;
    }
    const top = recent[0];
    if (top && getBrandToken(top.id)) {
      navigate(`/brand/player/${top.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { setError(STORE_VERIFY_ERROR_MESSAGES.empty_code); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await verifyStoreCode(trimmed);
      if (!res.success || !res.brand_id || !res.session_token) {
        setError(STORE_VERIFY_ERROR_MESSAGES[res.error ?? 'invalid_code'] ?? STORE_VERIFY_ERROR_MESSAGES.invalid_code);
        return;
      }
      saveBrandToken(res.brand_id, res.session_token);
      pushRecentBrand({ id: res.brand_id, name: res.store_label ?? '매장' });
      navigate(`/brand/player/${res.brand_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '매장 코드 확인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  function openRecent(id: string) {
    if (getBrandToken(id)) navigate(`/brand/player/${id}`);
    else setError('세션이 만료되었어요. 매장 코드를 다시 입력해주세요.');
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Tag size={28} />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">브랜드 플레이어</h1>
        <p className="text-sm leading-relaxed text-ink-mute">
          본사에서 받은 <b className="text-ink">매장 코드</b> 또는 <b className="text-ink">브랜드 코드</b>를 입력하면<br />
          우리 매장 전용 음악과 사이니지가 자동으로 재생돼요.
        </p>
        <p className="text-xs text-ink-dim">이 브라우저에서는 다음부터 코드 없이 자동으로 연결됩니다.</p>
      </div>

      {notice && (
        <p className="w-full rounded-xl bg-amber-500/10 px-4 py-3 text-center text-sm font-medium text-amber-600 dark:text-amber-300">{notice}</p>
      )}

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div className="space-y-2">
          <label htmlFor="store-code" className="flex items-center gap-1.5 text-xs font-semibold text-ink-mute">
            <KeyRound size={13} /> 매장 코드 · 브랜드 코드
          </label>
          <input
            id="store-code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            placeholder="운영중인 매장 브랜드명을 적어주세요"
            maxLength={40}
            disabled={loading}
            className="w-full rounded-2xl border border-line/30 bg-bg px-5 py-4 text-center text-xl font-bold tracking-[0.15em] text-ink outline-none ring-accent/40 placeholder:text-ink-dim/50 focus:ring-2 disabled:opacity-60"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm font-medium text-red-600 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-4 text-base font-bold text-black transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (<><Loader2 size={20} className="animate-spin" /> 확인 중…</>) : (<>재생 시작 <ArrowRight size={20} /></>)}
        </button>
      </form>

      {recent.length > 0 && (
        <div className="w-full space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-dim"><Clock size={12} /> 최근 접속</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((b) => (
              <button
                key={b.id}
                onClick={() => openRecent(b.id)}
                className="rounded-full border border-line/30 bg-bg-hover px-3.5 py-1.5 text-sm font-semibold text-ink-mute hover:border-accent/40 hover:text-ink"
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-xs leading-relaxed text-ink-dim">
        매장 코드는 <b className="text-ink-mute">본사 또는 관리자</b>에게 문의하세요.
      </p>
    </div>
  );
}
