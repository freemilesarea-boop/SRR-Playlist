// Phase BRAND-1 — 브랜드 코드 입력 페이지 (/brand).
// 초보 매장 직원도 이해 가능한 큰 입력창 + 큰 시작 버튼 + 쉬운 한국어 에러.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, ArrowRight, Loader2, KeyRound, Clock } from 'lucide-react';
import { verifyBrandCode } from '@/lib/api/brandPlayerApi';
import { saveBrandToken, pushRecentBrand, getRecentBrands, getBrandToken } from '@/lib/brandSession';
import { BRAND_VERIFY_ERROR_MESSAGES } from '@/types/brand';

export default function BrandPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = getRecentBrands();

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { setError(BRAND_VERIFY_ERROR_MESSAGES.empty_code); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await verifyBrandCode(trimmed);
      if (!res.success || !res.brand_id || !res.session_token) {
        setError(BRAND_VERIFY_ERROR_MESSAGES[res.error ?? 'invalid_code'] ?? BRAND_VERIFY_ERROR_MESSAGES.invalid_code);
        return;
      }
      saveBrandToken(res.brand_id, res.session_token);
      pushRecentBrand({ id: res.brand_id, name: res.brand_name ?? '브랜드' });
      navigate(`/brand/player/${res.brand_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '브랜드 코드 확인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  function openRecent(id: string) {
    // 유효한 세션 토큰이 남아있으면 바로 진입, 없으면 코드 재입력 유도
    if (getBrandToken(id)) navigate(`/brand/player/${id}`);
    else setError('세션이 만료되었어요. 브랜드 코드를 다시 입력해주세요.');
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Tag size={28} />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">브랜드 플레이어</h1>
        <p className="text-sm leading-relaxed text-ink-mute">
          본사에서 받은 <b className="text-ink">브랜드 코드</b>를 입력하면<br />
          전용 음악과 사이니지가 자동으로 재생돼요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div className="space-y-2">
          <label htmlFor="brand-code" className="flex items-center gap-1.5 text-xs font-semibold text-ink-mute">
            <KeyRound size={13} /> 브랜드 코드
          </label>
          <input
            id="brand-code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            placeholder="예: ABCD2345"
            maxLength={20}
            disabled={loading}
            className="w-full rounded-2xl border border-line/30 bg-bg px-5 py-4 text-center text-2xl font-bold tracking-[0.25em] text-ink outline-none ring-accent/40 placeholder:text-ink-dim/50 focus:ring-2 disabled:opacity-60"
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
        브랜드 코드는 <b className="text-ink-mute">본사 또는 관리자</b>에게 문의하세요.
      </p>
    </div>
  );
}
