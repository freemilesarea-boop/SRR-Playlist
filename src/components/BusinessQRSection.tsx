import { lazy, Suspense, useState } from 'react';
import { QrCode, ChevronDown } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';
import { playlistShareUrl } from '@/lib/shareApi';
// WEB-OPT-3 — QR 모달(→ react-qr-code)은 열 때만 로드.
const QRCodeModal = lazy(() => import('@/components/QRCodeModal'));

export default function BusinessQRSection({
  playlists,
}: {
  playlists: PlaylistRow[];
}) {
  const [selected, setSelected] = useState<PlaylistRow | null>(playlists[0] ?? null);
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  if (playlists.length === 0) return null;

  return (
    <section className="space-y-3 rounded-3xl bg-bg-card p-5 shadow-card ring-1 ring-line/10">
      <div className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <QrCode size={16} className="text-accent" /> 매장 QR 만들기
        </h2>
        <p className="text-xs text-ink-mute">
          손님들이 매장 음악을 폰에 저장할 수 있게, 출입구·테이블에 붙이세요.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-ink-mute">플레이리스트 선택</label>
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-xl bg-bg-soft px-4 py-3 text-sm ring-1 ring-line/10 hover:bg-bg-hover"
          >
            <span className="truncate">
              {selected?.title ?? '플레이리스트를 선택해주세요'}
              {selected?.category && (
                <span className="ml-2 text-xs text-ink-dim">{selected.category}</span>
              )}
            </span>
            <ChevronDown size={14} className={`shrink-0 text-ink-dim transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl bg-bg-soft shadow-lift ring-1 ring-line/15">
              {playlists.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setSelected(p);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-bg-hover"
                  >
                    <span className="truncate">{p.title}</span>
                    <span className="ml-2 text-[10px] text-ink-dim">{p.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        onClick={() => selected && setQrOpen(true)}
        disabled={!selected}
        className="btn-primary w-full py-3"
      >
        <QrCode size={14} /> QR 코드 생성
      </button>

      <div className="rounded-xl bg-bg-soft p-3 text-[11px] text-ink-mute ring-1 ring-line/10">
        <p className="font-semibold text-ink">매장 안내 문구 예시</p>
        <p className="mt-1">“지금 이 매장에서 흐르는 음악 — QR을 스캔하고 플레이리스트를 저장해보세요”</p>
      </div>

      {qrOpen && selected && (
        <Suspense fallback={null}>
          <QRCodeModal
            url={playlistShareUrl(selected.id)}
            title={selected.title}
            subtitle="지금 이 매장에서 흐르는 음악"
            targetType="business_qr"
            targetId={selected.id}
            onClose={() => setQrOpen(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
