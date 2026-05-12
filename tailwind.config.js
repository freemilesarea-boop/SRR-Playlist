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
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          'sans-serif',
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
