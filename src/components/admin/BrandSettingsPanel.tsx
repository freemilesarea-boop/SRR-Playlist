import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, Trash2, ExternalLink } from 'lucide-react';
import { adminUploadBrandLogo, adminClearBrandLogo, fetchBrandSettings } from '@/lib/brandApi';
import { useBrandStore } from '@/store/brandStore';
import { toast } from '@/store/toastStore';
import BrandLogo from '@/components/BrandLogo';
import { friendlyError } from '@/lib/errorMessages';

/**
 * 관리자 — 브랜드 로고 업로드/교체/제거.
 * SVG 권장 (벡터, 크기 무관). PNG/JPEG/WebP 도 허용. 2MB 이하.
 * URL 비우면 클라이언트가 LogoMark SVG 폴백 사용.
 */
export default function BrandSettingsPanel() {
  const logoUrl = useBrandStore((s) => s.logo_url);
  const updatedAt = useBrandStore((s) => s.updated_at);
  const setLogoUrl = useBrandStore((s) => s.setLogoUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // 진입 시 최신 상태 한 번 더 fetch (다른 관리자가 갱신했을 가능성)
  useEffect(() => {
    void fetchBrandSettings().then((s) => setLogoUrl(s.logo_url));
  }, [setLogoUrl]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const r = await adminUploadBrandLogo(file);
      if (!r.ok) throw new Error(r.error ?? '업로드 실패');
      setLogoUrl(r.url ?? null);
      toast.success('로고를 업데이트했어요.');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onClear() {
    if (!confirm('업로드된 로고를 제거하고 기본 SVG 로 되돌릴까요?')) return;
    setBusy(true);
    try {
      const r = await adminClearBrandLogo();
      if (!r.ok) throw new Error(r.error ?? '제거 실패');
      setLogoUrl(null);
      toast.success('기본 로고로 복원했어요.');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <ImageIcon size={16} className="text-accent" /> 브랜드 로고
        </h2>
        <p className="text-xs text-ink-mute">
          좌측 사이드바 / 로딩 등에 표시되는 브랜드 마크. SVG 권장 (벡터, 어떤 크기에도 깨지지 않음). 2MB 이하 SVG/PNG/JPEG/WebP.
        </p>
      </header>

      {/* Preview — 다양한 배경에서 어떻게 보이는지 미리보기 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <PreviewTile label="On Ink" bg="#0A0A0A" textClass="text-white">
          <BrandLogo size={48} fallbackColorClass="text-white" />
        </PreviewTile>
        <PreviewTile label="On Bone" bg="#EFECE6" textClass="text-black">
          <BrandLogo size={48} fallbackColorClass="text-black" />
        </PreviewTile>
        <PreviewTile label="On Sonic Violet" bg="#7B3FF2" textClass="text-white">
          <BrandLogo size={48} fallbackColorClass="text-white" />
        </PreviewTile>
      </div>

      {/* 현재 상태 + 업로드 컨트롤 */}
      <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">현재</p>
            <p className="mt-1 text-sm font-semibold">
              {logoUrl ? '업로드된 로고 사용 중' : '기본 LogoMark SVG (폴백) 사용 중'}
            </p>
            {logoUrl && (
              <a href={logoUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                파일 열기 <ExternalLink size={12} />
              </a>
            )}
            {updatedAt && (
              <p className="mt-1 font-mono text-[10px] text-ink-dim">
                업데이트 {new Date(updatedAt).toLocaleString('ko-KR')}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/svg+xml,image/png,image/jpeg,image/webp"
            onChange={(e) => void onPick(e)}
            className="hidden"
            id="brand-logo-file"
          />
          <label
            htmlFor="brand-logo-file"
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-soft ${busy ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Upload size={14} /> {busy ? '업로드 중…' : logoUrl ? '교체 업로드' : '로고 업로드'}
          </label>
          {logoUrl && (
            <button
              onClick={() => void onClear()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-bg-soft px-4 py-2 text-sm font-semibold text-ink-mute ring-1 ring-line/10 transition hover:text-ink disabled:opacity-50"
            >
              <Trash2 size={14} /> 기본으로 되돌리기
            </button>
          )}
        </div>

        <ul className="space-y-1 pt-1 text-[11px] leading-relaxed text-ink-dim">
          <li>• SVG 추천 — stroke "currentColor" 라면 컨텍스트(흰/검정/보라)에서 자동 색상 적응. 단색 SVG 권장.</li>
          <li>• PNG/JPEG/WebP — 투명 배경 권장. 흰 배경 위에 그대로 깔리면 어색해 보일 수 있음.</li>
          <li>• 변경 즉시 반영 — 모든 사용자가 다음 페이지 로드 때부터 새 로고를 봅니다 (캐시 약 5분).</li>
        </ul>
      </div>
    </div>
  );
}

function PreviewTile({ label, bg, textClass, children }: { label: string; bg: string; textClass: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl p-5 ring-1 ring-line/10" style={{ background: bg }}>
      <p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${textClass} opacity-70`}>{label}</p>
      <div className={textClass}>{children}</div>
    </div>
  );
}
