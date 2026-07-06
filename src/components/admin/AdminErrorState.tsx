import { AlertTriangle, Database, ShieldOff, WifiOff, Copy, Check, Zap, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import type { AdminError } from '@/lib/adminErrors';
import { applyAnalyticsDb, type ApplyAnalyticsResult } from '@/lib/adminApi';

const MIGRATION_CMD = `cd ~/SRR-Playlist
git pull
supabase db push`;

export default function AdminErrorState({
  error,
  onRetry,
}: {
  error: AdminError;
  onRetry?: () => void | Promise<void>;
}) {
  if (error.kind === 'migration_missing')
    return <MigrationMissing message={error.message} onRetry={onRetry} />;
  if (error.kind === 'permission') return <PermissionError message={error.message} />;
  if (error.kind === 'network') return <NetworkError message={error.message} />;
  return <UnknownError message={error.message} />;
}

function MigrationMissing({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyAnalyticsResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function onApply() {
    setBusy(true);
    setResult(null);
    try {
      const res = await applyAnalyticsDb();
      setResult(res);
      if (res.ok && onRetry) await onRetry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-amber-100 p-6 ring-1 ring-amber-400/40 dark:bg-amber-500/20 dark:ring-amber-400/50">
      <div className="flex items-start gap-3">
        <Database size={20} className="mt-0.5 shrink-0 text-slate-900 dark:text-amber-200 dark:text-amber-300" />
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-amber-200 dark:text-amber-100">
            분석 DB 객체가 아직 적용되지 않았어요
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-amber-200/80 dark:text-ink-mute">
            <code className="rounded bg-bg-soft px-1 py-0.5 font-mono text-[11px]">
              0002_analytics.sql
            </code>{' '}
            의 테이블 / RLS / RPC 가 운영 DB 에 누락되어 있습니다. 아래 버튼 한 번으로 자동
            적용할 수 있어요. 이미 일부가 적용된 환경에서도 안전합니다 (멱등).
          </p>
        </div>
      </div>

      {/* === 자동 적용 버튼 === */}
      <button
        onClick={onApply}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-bold text-bg shadow-sm hover:opacity-90 disabled:opacity-50"
      >
        <Zap size={16} />
        {busy ? '분석 DB를 적용하고 있어요…' : '분석 DB 자동 적용'}
      </button>

      {result && (
        <div
          className={`rounded-xl p-3 ring-1 ${
            result.ok
              ? 'bg-emerald-100 ring-emerald-400/40 dark:bg-emerald-500/20 dark:ring-emerald-500/50'
              : 'bg-red-100 ring-red-400/40 dark:bg-rose-500/20 dark:ring-rose-500/50'
          }`}
        >
          {result.ok ? (
            <div className="space-y-1 text-xs">
              <p className="flex items-center gap-1 font-bold text-slate-900 dark:text-emerald-200 dark:text-emerald-200">
                <CheckCircle2 size={14} /> 분석 DB 적용 완료
              </p>
              <p className="text-slate-700 dark:text-emerald-200/80 dark:text-emerald-100/85">{result.message}</p>
              {(result.created_tables?.length ?? 0) > 0 && (
                <p className="text-slate-700 dark:text-emerald-200/70 dark:text-ink-mute">
                  생성 테이블:{' '}
                  <code className="font-mono">{result.created_tables!.join(', ')}</code>
                </p>
              )}
              {(result.created_functions?.length ?? 0) > 0 && (
                <p className="text-slate-700 dark:text-emerald-200/70 dark:text-ink-mute">
                  생성 RPC:{' '}
                  <code className="font-mono">{result.created_functions!.join(', ')}</code>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1 text-xs">
              <p className="font-bold text-slate-900 dark:text-rose-200 dark:text-red-200">자동 적용 실패</p>
              <p className="font-mono text-slate-900 dark:text-rose-200 dark:text-red-300">{result.error}</p>
              {result.details && (
                <pre className="overflow-x-auto rounded bg-bg-deep/60 p-2 text-[10px] text-slate-700 dark:text-rose-200/85 dark:text-red-300/85">
                  {result.details}
                </pre>
              )}
              {result.hint && (
                <p className="rounded bg-amber-200/70 p-2 text-slate-900 dark:text-amber-200 dark:bg-amber-500/25 dark:text-amber-200">
                  💡 {result.hint}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* === 고급 옵션: 터미널 / SQL Editor 수동 적용 === */}
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-dim">
          고급 옵션 — 자동 적용이 안 될 때 (터미널 / SQL Editor)
        </summary>
        <div className="mt-3 space-y-3">
          <div className="relative">
            <pre className="overflow-x-auto rounded-xl bg-bg-soft p-3 text-xs leading-relaxed text-ink">
              {MIGRATION_CMD}
            </pre>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(MIGRATION_CMD).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-bg-hover px-2 py-1 text-[11px] hover:bg-ink/10"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <ol className="list-decimal space-y-1 pl-4 text-ink-mute">
            <li>
              로컬 터미널:{' '}
              <code className="font-mono">cat supabase/migrations/0002_analytics.sql | pbcopy</code>
            </li>
            <li>Supabase Dashboard → SQL Editor → 새 쿼리 → 붙여넣기 → Run</li>
            <li>
              또는 GitHub Actions 의 "DB · 추천 메타데이터 시드 적용" 워크플로 실행
            </li>
          </ol>
        </div>
      </details>

      <details className="text-xs">
        <summary className="cursor-pointer text-ink-dim">원본 에러 보기</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">
          {message}
        </pre>
      </details>
    </div>
  );
}

function PermissionError({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-red-100 p-6 ring-1 ring-red-400/40 dark:bg-rose-500/20 dark:ring-rose-400/50">
      <div className="flex items-start gap-3">
        <ShieldOff size={20} className="mt-0.5 shrink-0 text-slate-900 dark:text-rose-200 dark:text-red-300" />
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-rose-200 dark:text-red-200">권한이 없어요</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-rose-200/80 dark:text-ink-mute">
            현재 계정에 admin 권한이 없어요. SQL Editor 에서 본인 user 의 role 을 admin 으로
            변경해주세요 — README.md "관리자 계정 설정" 섹션.
          </p>
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-dim">원본 에러 보기</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">
          {message}
        </pre>
      </details>
    </div>
  );
}

function NetworkError({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-bg-card p-6 ring-1 ring-line/15">
      <div className="flex items-start gap-3">
        <WifiOff size={20} className="mt-0.5 shrink-0 text-ink-mute" />
        <div>
          <h3 className="text-base font-bold">네트워크 오류</h3>
          <p className="mt-1 text-xs text-ink-mute">
            Supabase 에 연결할 수 없어요. 잠시 후 새로고침해주세요.
          </p>
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-dim">원본 에러 보기</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">
          {message}
        </pre>
      </details>
    </div>
  );
}

function UnknownError({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-bg-card p-6 ring-1 ring-line/15">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-yellow-300" />
        <div>
          <h3 className="text-base font-bold">알 수 없는 오류</h3>
          <p className="mt-1 text-xs text-ink-mute">관리자에게 아래 메시지를 전달해주세요.</p>
        </div>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">
        {message}
      </pre>
    </div>
  );
}
