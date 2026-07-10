// Phase WEB-OPT-2 — 앱 최상단 Root ErrorBoundary.
//
// 목적:
//   렌더 단계에서 발생한 어떤 예외도 여기서 포착해 "백지" 대신 복구 UI 를 보여준다.
//   (기존에는 root ErrorBoundary 가 없어 render throw 시 트리 전체가 unmount → #root 백지 →
//    index.html 8초 watchdog 만이 유일한 복구였고, 결정적 오류면 영구 백지였다.)
//
// 원칙:
//   • 인증/재생/큐/스토어를 절대 건드리지 않는다(읽지도 쓰지도 않음).
//   • fallback UI 는 CSS chunk 가 실패해도 보이도록 inline style 만 사용(Tailwind 의존 X).
//   • 사용자에게 stack trace 노출 금지. release(build) id 만 진단용으로 표시.
//   • "다시 시도"는 재렌더만(자동 reload 아님) → 무한 reload 없음. "새로고침"은 사용자 클릭 1회.
//   • 반복 실패 시에만 "캐시 정리 후 새로고침"(앱 캐시 + SW 만, 사용자 데이터/세션은 보존).
//   • ErrorBoundary 자체가 죽지 않도록 의존성 최소화(Sentry 호출은 실패해도 무시).
import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { BUILD_ID, isAppCacheName, isChunkLoadError } from '@/lib/bootRecovery';
import { captureBootFailure } from '@/lib/sentry';

interface Props { children: ReactNode }
interface State { hasError: boolean; resetKey: number; errorCount: number; isChunk: boolean }

/** React 정상 mount 를 watchdog 이 판별할 수 있게 하는 boot marker. */
function markBooted(): void {
  try {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.appBooted = 'true';
    }
  } catch { /* noop */ }
}

/** 앱(workbox) 캐시 + SW 만 정리하고 1회 새로고침. 사용자 데이터/세션/설정은 보존. */
async function purgeAppCachesAndReload(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isAppCacheName).map((k) => caches.delete(k)));
    }
  } catch { /* best-effort */ }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* best-effort */ }
  try { window.location.reload(); } catch { /* noop */ }
}

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, resetKey: 0, errorCount: 0, isChunk: false };

  static getDerivedStateFromError(err: unknown): Partial<State> {
    return { hasError: true, isChunk: isChunkLoadError(err) };
  }

  componentDidMount(): void {
    // React 트리가 실제로 mount 됨 → boot 완료 marker(성공/폴백 모두 이 시점 도달).
    markBooted();
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState((s) => ({ errorCount: s.errorCount + 1 }));
    // Sentry 로 최소 진단 전송(토큰/개인정보 없음). 실패해도 앱에 영향 없음.
    try {
      void captureBootFailure(error, {
        componentStack: typeof info?.componentStack === 'string' ? info.componentStack.slice(0, 4000) : undefined,
        chunk: isChunkLoadError(error),
      });
    } catch { /* noop */ }
  }

  private handleRetry = (): void => {
    // 재렌더만 시도 — reload 아님(무한 reload 방지). key 변경으로 children 재mount.
    this.setState((s) => ({ hasError: false, isChunk: false, resetKey: s.resetKey + 1 }));
  };

  private handleReload = (): void => {
    try { window.location.reload(); } catch { /* noop */ }
  };

  private handleSafeRecover = (): void => {
    void purgeAppCachesAndReload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      // key 로 감싸 "다시 시도" 시 하위 트리를 깨끗이 재mount.
      return <div key={this.state.resetKey} style={{ display: 'contents' }}>{this.props.children}</div>;
    }

    const repeated = this.state.errorCount >= 2;
    return (
      <div style={styles.overlay} role="alert" aria-live="assertive">
        <div style={styles.card}>
          <div style={styles.emoji} aria-hidden>🎧</div>
          <h1 style={styles.title}>화면을 불러오지 못했습니다.</h1>
          <p style={styles.desc}>
            일시적인 업데이트 또는 캐시 문제일 수 있습니다.
            {this.state.isChunk ? ' 새 버전이 배포되어 화면 파일을 갱신해야 할 수 있어요.' : ''}
          </p>
          <div style={styles.row}>
            <button type="button" onClick={this.handleRetry} style={{ ...styles.btn, ...styles.btnGhost }}>
              다시 시도
            </button>
            <button type="button" onClick={this.handleReload} style={{ ...styles.btn, ...styles.btnPrimary }}>
              새로고침
            </button>
          </div>
          {repeated && (
            <div style={styles.escalate}>
              <p style={styles.escalateText}>
                문제가 계속되면 저장된 화면 캐시를 정리한 뒤 다시 불러올 수 있어요. (로그인·재생 설정은 유지됩니다)
              </p>
              <button type="button" onClick={this.handleSafeRecover} style={{ ...styles.btn, ...styles.btnDanger }}>
                캐시 정리 후 새로고침
              </button>
            </div>
          )}
          <p style={styles.diag}>릴리스 {BUILD_ID}</p>
        </div>
      </div>
    );
  }
}

// inline style — CSS chunk 로드 실패에도 항상 렌더되도록. 모바일/태블릿 안전(고정 max-width + safe-area).
const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2147483647,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
    background: '#0a0a0a', color: '#fff',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    WebkitTextSizeAdjust: '100%',
  },
  card: { width: '100%', maxWidth: 420, textAlign: 'center' },
  emoji: { fontSize: 44, lineHeight: 1, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: 800, margin: '0 0 8px' },
  desc: { fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', margin: '0 0 20px' },
  row: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  btn: {
    appearance: 'none', border: 'none', borderRadius: 12, padding: '12px 20px',
    fontSize: 14, fontWeight: 700, cursor: 'pointer', minWidth: 120, minHeight: 44,
  },
  btnPrimary: { background: '#7c5cff', color: '#fff' },
  btnGhost: { background: 'rgba(255,255,255,0.1)', color: '#fff' },
  btnDanger: { background: 'rgba(255,90,90,0.16)', color: '#ff9a9a', marginTop: 4 },
  escalate: { marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' },
  escalateText: { fontSize: 12.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.55)', margin: '0 0 10px' },
  diag: { marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'ui-monospace, monospace' },
};
