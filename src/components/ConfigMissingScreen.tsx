import { AlertCircle, Copy, Check } from 'lucide-react';
import { useState } from 'react';

const SAMPLE_ENV = `VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`;

export default function ConfigMissingScreen() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-bg-card p-6 ring-1 ring-yellow-500/30">
        <div className="flex items-center gap-2 text-yellow-300">
          <AlertCircle size={18} />
          <h1 className="text-lg font-bold">Supabase 환경 변수가 설정되지 않았어요</h1>
        </div>

        <p className="text-sm leading-relaxed text-ink-mute">
          앱을 실행하려면 Supabase 프로젝트 URL과 anon key가 필요해요. 프로젝트 루트에{' '}
          <code className="rounded bg-bg-hover px-1 py-0.5 font-mono text-xs">.env</code> 파일을
          만들고 아래 두 줄을 추가한 뒤 다시 실행해주세요.
        </p>

        <div className="relative">
          <pre className="overflow-x-auto rounded-xl bg-bg-soft p-3 text-xs leading-relaxed text-ink">
            {SAMPLE_ENV}
          </pre>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(SAMPLE_ENV).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-bg-hover px-2 py-1 text-[11px] text-ink-mute hover:text-ink"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '복사됨' : '복사'}
          </button>
        </div>

        <ol className="space-y-2 text-xs text-ink-mute">
          <li>
            1.{' '}
            <a
              href="https://supabase.com"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              supabase.com
            </a>{' '}
            에서 프로젝트 생성
          </li>
          <li>2. Project Settings → API 에서 URL · anon key 복사</li>
          <li>3. SQL Editor 에서 supabase/schema.sql 실행</li>
          <li>4. Storage 에서 audio · covers 버킷 (Public) 생성</li>
        </ol>

        <p className="text-[11px] text-ink-dim">
          자세한 절차는 README.md 의 “Supabase 준비” 섹션 참고
        </p>
      </div>
    </div>
  );
}
