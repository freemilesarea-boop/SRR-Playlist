import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Store, Smartphone, Sparkles, Play, ArrowRight, X } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';
import { useInstallPrompt, isStandalone } from '@/hooks/useInstallPrompt';

const STORAGE_KEY = 'srr-onboarding-seen';

type Mode = 'personal' | 'business';

/** account_type 으로부터 onboarding mode 자동 결정. artist 는 별도 흐름이라 모달 자체 미노출. */
function modeFromAccountType(accountType: string | undefined | null): Mode | null {
  switch (accountType) {
    case 'business':
      return 'business';
    case 'individual':
      return 'personal';
    case 'artist':
      return null; // 아티스트는 onboarding 모달 안 띄움
    default:
      return null;
  }
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { profile, loading } = useAuthStore();
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);
  const { canInstall, prompt } = useInstallPrompt();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    if (loading || !profile) return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (seen) return;
    } catch {
      /* localStorage 막힌 환경: 매번 모달 노출 (마찰 < 안 보임) */
    }
    // 가입 시 결정된 account_type 으로 mode 자동 설정.
    // - business / individual: Step 1 부터 시작 (mode 선택 화면 생략)
    // - artist: 모달 자체 미노출 (별도 /artist 대시보드가 안내)
    // - account_type 누락 / unknown: 기존 mode 선택 화면 표시
    const autoMode = modeFromAccountType(profile.account_type);
    if (profile.account_type === 'artist') {
      // 모달 안 띄움 + seen 표시해 다음 방문 시도 차단
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        /* noop */
      }
      return;
    }
    if (autoMode) {
      setMode(autoMode);
      setStep(1);
    }
    setOpen(true);
  }, [loading, profile]);

  function close() {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* noop */
    }
    setOpen(false);
  }

  function chooseMode(m: Mode) {
    setMode(m);
    setStep(1);
  }

  function next() {
    setStep((s) => s + 1);
  }

  function finish() {
    close();
    if (mode === 'business') {
      setBusinessMode(true);
      navigate('/business');
    }
  }

  if (!open) return null;

  // X6.42: focus trap + Esc
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose: close });

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl animate-slide-up">
        {/* 그라데이션 배경 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/20 via-transparent to-transparent" />

        <div className="relative flex items-center justify-between p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-accent">
            듣다에 오신 걸 환영해요
          </p>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-mute hover:bg-ink/5 hover:text-ink"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative px-6 pb-7">
          {/* 스텝 0: 모드 선택 */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-extrabold leading-snug">
                어떻게 사용할 계획이세요?
              </h2>
              <p className="text-sm text-ink-mute">선택에 따라 안내가 달라져요.</p>

              <div className="space-y-2 pt-2">
                <ModeOption
                  icon={<Music size={18} />}
                  title="혼자 듣고 싶어요"
                  description="감성 플레이리스트를 가볍게 즐겨요"
                  onClick={() => chooseMode('personal')}
                />
                <ModeOption
                  icon={<Store size={18} />}
                  title="우리 매장에 틀고 싶어요"
                  description="자영업자용 매장 BGM 자동 운영"
                  onClick={() => chooseMode('business')}
                  accent
                />
              </div>
            </div>
          )}

          {/* PERSONAL: 3 steps */}
          {mode === 'personal' && step === 1 && (
            <Step
              icon={<Sparkles size={20} />}
              title="원하는 분위기를 골라주세요"
              body="홈 화면의 카테고리에서 새벽 감성 / 공부 집중 / 카페 음악 / 드라이브 등 지금 마음에 드는 무드를 선택할 수 있어요."
              progress="1/3"
              onNext={next}
            />
          )}
          {mode === 'personal' && step === 2 && (
            <Step
              icon={<Play size={20} />}
              title="플레이리스트를 재생해보세요"
              body="플리를 누르면 곡 목록이 보여요. ▶ 재생 또는 셔플로 바로 들으실 수 있어요. 좋으면 ❤️ 로 보관함에 담아두세요."
              progress="2/3"
              onNext={next}
            />
          )}
          {mode === 'personal' && step === 3 && (
            <Step
              icon={<Smartphone size={20} />}
              title="홈 화면에 추가해서 앱처럼"
              body="브라우저 메뉴 → ‘홈 화면에 추가’ 를 누르면 앱 아이콘으로 등장해요. 백그라운드 재생도 더 안정적이에요."
              progress="3/3"
              ctaLabel={canInstall ? '설치하기' : '시작하기'}
              onNext={() => {
                if (canInstall && !isStandalone()) {
                  void prompt().finally(close);
                } else {
                  finish();
                }
              }}
            />
          )}

          {/* BUSINESS: 3 steps */}
          {mode === 'business' && step === 1 && (
            <Step
              icon={<Store size={20} />}
              title="매장 업종을 골라주세요"
              body="매장 페이지에서 카페 / PT샵 / 필라테스 / 와인바 / 네일샵 / 편집샵 중 본인 매장에 맞는 업종을 선택하면 추천이 더 정확해져요."
              progress="1/3"
              onNext={next}
            />
          )}
          {mode === 'business' && step === 2 && (
            <Step
              icon={<Sparkles size={20} />}
              title="시간대 자동 추천을 확인하세요"
              body="오전 / 오후 / 저녁 / 밤마다 어울리는 플리가 자동으로 떠요. 직접 고르지 않아도 매장 분위기가 자연스럽게 흘러갑니다."
              progress="2/3"
              onNext={next}
            />
          )}
          {mode === 'business' && step === 3 && (
            <Step
              icon={<Play size={20} />}
              title="‘매장 모드 시작’ 한 번만 누르세요"
              body="셔플 + 무한 반복 + 화면 꺼짐 방지가 자동으로 켜져요. 폰을 매장에 두기만 하면 끝. 홈 화면에 추가해두면 앱처럼 사용할 수 있어요."
              progress="3/3"
              ctaLabel="매장 페이지로"
              onNext={finish}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ModeOption({
  icon,
  title,
  description,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left transition ${
        accent
          ? 'bg-gradient-to-br from-accent-soft/30 to-bg-card ring-1 ring-accent/30 hover:from-accent-soft/40'
          : 'bg-bg-card ring-1 ring-line/10 hover:bg-bg-hover'
      }`}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          accent ? 'bg-accent text-black' : 'bg-ink/10 text-ink'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 text-xs text-ink-mute">{description}</p>
      </div>
      <ArrowRight size={16} className="text-ink-dim" />
    </button>
  );
}

function Step({
  icon,
  title,
  body,
  progress,
  onNext,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  progress: string;
  onNext: () => void;
  ctaLabel?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30">
          {icon}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
          STEP {progress}
        </span>
      </div>
      <h2 className="text-xl font-extrabold leading-snug">{title}</h2>
      <p className="text-sm leading-relaxed text-ink-mute">{body}</p>
      <button
        onClick={onNext}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-sm font-bold text-black transition active:scale-[0.99]"
      >
        {ctaLabel ?? '다음'}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
