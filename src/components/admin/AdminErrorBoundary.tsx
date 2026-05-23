import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  /** 값이 바뀌면 에러 상태를 자동 리셋한다 (탭 전환 시 직전 탭의 에러를 끌고 가지 않도록). */
  resetKey?: string | number;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 관리자 탭 패널용 런타임 에러 경계.
 * 한 패널이 렌더 중 throw 해도 관리자 페이지 전체가 화이트스크린되지 않고
 * 해당 영역만 폴백 UI 로 격리한다.
 */
export default class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // 탭(resetKey) 이 바뀌면 에러 상태 초기화
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[AdminErrorBoundary]', error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="space-y-3 rounded-2xl bg-red-100 p-6 ring-1 ring-red-400/40 dark:bg-red-500/10 dark:ring-red-400/30">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-700 dark:text-red-300" />
            <div>
              <h3 className="text-base font-bold text-red-900 dark:text-red-200">
                이 화면을 표시하는 중 오류가 발생했어요
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-red-900/80 dark:text-ink-mute">
                다른 탭은 정상 동작합니다. 아래 새로고침을 눌러 이 화면만 다시 시도해주세요.
              </p>
            </div>
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-bg hover:opacity-90"
          >
            <RotateCw size={13} /> 다시 시도
          </button>
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-dim">원본 에러 보기</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
