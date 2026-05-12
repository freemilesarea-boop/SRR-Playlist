import { AlertTriangle, Database, ShieldOff, WifiOff, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { AdminError } from '@/lib/adminErrors';

const MIGRATION_CMD = `cd ~/SRR-Playlist
git pull
supabase db push`;

export default function AdminErrorState({ error }: { error: AdminError }) {
  if (error.kind === 'migration_missing') return <MigrationMissing message={error.message} />;
  if (error.kind === 'permission') return <PermissionError message={error.message} />;
  if (error.kind === 'network') return <NetworkError message={error.message} />;
  return <UnknownError message={error.message} />;
}

function MigrationMissing({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4 rounded-2xl bg-yellow-500/5 p-6 ring-1 ring-yellow-400/30">
      <div className="flex items-start gap-3">
        <Database size={20} className="mt-0.5 shrink-0 text-yellow-300" />
        <div>
          <h3 className="text-base font-bold text-yellow-200">
            관리자 분석 DB가 아직 적용되지 않았어요
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-mute">
            <code className="rounded bg-bg-soft px-1 py-0.5 font-mono text-[11px]">
              supabase/migrations/0002_analytics.sql
            </code>{' '}
            이 원격 Supabase 에 적용되지 않았습니다. 아래 한 줄로 적용하세요.
          </p>
        </div>
      </div>

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
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-bg-hover px-2 py-1 text-[11px] hover:bg-white/10"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>

      <div className="space-y-1 text-xs text-ink-mute">
        <p className="font-semibold text-ink">또는 대시보드 SQL Editor 에서:</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>로컬 터미널: <code className="font-mono">cat supabase/migrations/0002_analytics.sql | pbcopy</code></li>
          <li>Supabase Dashboard → SQL Editor → 새 쿼리 → 붙여넣기 → Run</li>
        </ol>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-ink-dim">원본 에러 보기</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">{message}</pre>
      </details>
    </div>
  );
}

function PermissionError({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-red-500/5 p-6 ring-1 ring-red-400/30">
      <div className="flex items-start gap-3">
        <ShieldOff size={20} className="mt-0.5 shrink-0 text-red-300" />
        <div>
          <h3 className="text-base font-bold text-red-200">권한이 없어요</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-mute">
            현재 계정에 admin 권한이 없어요. SQL Editor 에서 본인 user 의 role 을 admin 으로
            변경해주세요 — README.md “관리자 계정 설정” 섹션.
          </p>
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-dim">원본 에러 보기</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">{message}</pre>
      </details>
    </div>
  );
}

function NetworkError({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-bg-card p-6 ring-1 ring-white/10">
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
        <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">{message}</pre>
      </details>
    </div>
  );
}

function UnknownError({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-bg-card p-6 ring-1 ring-white/10">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-yellow-300" />
        <div>
          <h3 className="text-base font-bold">알 수 없는 오류</h3>
          <p className="mt-1 text-xs text-ink-mute">관리자에게 아래 메시지를 전달해주세요.</p>
        </div>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft p-2 text-[10px] text-ink-mute">{message}</pre>
    </div>
  );
}
