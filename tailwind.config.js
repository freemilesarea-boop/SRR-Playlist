/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
          soft: 'rgb(var(--color-bg-soft) / <alpha-value>)',
          // bg-deep 은 484곳에서 쓰이는데 여기 정의가 없어서 클래스가 통째로 무시됐다
          // (.bg-bg-deep 규칙이 빌드 CSS 에 0개 — 입력칸·코드칩·스켈레톤 배경이 전부 안 칠해졌다).
          // 별도 변수를 두되, 테마마다 새로 정의하지 않아도 되게 bg-soft 로 떨어뜨린다.
          // "deep" 의 뜻(본문보다 한 단 들어간 면)과 bg-soft 의 값이 다크·라이트 모두에서 맞는다.
          deep: 'rgb(var(--color-bg-deep, var(--color-bg-soft)) / <alpha-value>)',
          // bg-base 도 마찬가지로 정의가 없어 죽어 있었다(PricingPage 8곳, 규칙 0개).
          // 이름 그대로 기본 배경이라 DEFAULT 와 같은 값. 그 카드들은 페이지 배경 위에
          // 바로 놓여 있어서 칠해져도 지금과 같게 보인다.
          base: 'rgb(var(--color-bg) / <alpha-value>)',
          card: 'rgb(var(--color-surface) / <alpha-value>)',
          hover: 'rgb(var(--color-surface-soft) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          soft: 'rgb(var(--color-accent-soft) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          mute: 'rgb(var(--color-ink-mute) / <alpha-value>)',
          dim: 'rgb(var(--color-ink-dim) / <alpha-value>)',
        },
        line: 'rgb(var(--color-border) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },
      boxShadow: {
        soft: 'var(--shadow-sm)',
        card: 'var(--shadow-md)',
        lift: 'var(--shadow-lg)',
        elevated: 'var(--shadow-xl)',
        dock: 'var(--shadow-dock)',
      },
      transitionTimingFunction: {
        emphasized: 'var(--ease-out-expo)',
      },
      transitionDuration: {
        smooth: 'var(--dur-base)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'glow-pulse': 'glowPulse 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(24px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '0.9' },
        },
      },
    },
  },
  plugins: [],
};
