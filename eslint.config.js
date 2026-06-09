// ESLint flat config (X6.51 — Tier 4.3)
// 정책: "최소 엄격" — 실수 catch + react-hooks 안전성 + 미사용 식별자 발견.
//      type-aware 룰 (no-floating-promises 등) 은 제외 (성능/노이즈 부담).
//      legacy 코드의 잔여 violation 은 warn (build 차단 안 함).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'supabase/migrations/**',
      'supabase/functions/**',  // Deno — 별도 lint 필요
      'scripts/**',              // node CLI — 분리된 환경
      '*.config.js',
      '*.config.ts',
      'dev-dist/**',
    ],
  },

  // 기본 권장
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      // === 진짜 버그 catch ===
      'no-debugger': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-binary-expression': 'error',
      'no-prototype-builtins': 'off',  // legacy patterns 흔함
      'preserve-caught-error': 'off',  // ES2025 Error.cause — legacy 미사용
      // 의도된 expression statements (toast?.error, etc.) — warn 만
      '@typescript-eslint/no-unused-expressions': ['warn', {
        allowShortCircuit: true,
        allowTernary: true,
      }],

      // === TypeScript ===
      // unused vars: argsIgnorePattern '^_' 으로 의도적 unused 마킹 가능
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': 'allow-with-description',
      }],
      // legacy: empty object type 가끔 의도적
      '@typescript-eslint/no-empty-object-type': 'warn',
      // empty function body 종종 의도적 (no-op handler)
      '@typescript-eslint/no-empty-function': 'off',
      // require/CommonJS 가끔 사용
      '@typescript-eslint/no-require-imports': 'off',

      // === React ===
      // hooks deps — legacy 에서 의도적 누락 다수, warn
      'react-hooks/exhaustive-deps': 'warn',
      // rules-of-hooks 가 진짜 버그지만 legacy 위반 다수 → warn (점진적 fix)
      'react-hooks/rules-of-hooks': 'warn',
      // 신규 react-hooks v7 룰 — legacy 코드에 100+ 위반. 점진적 활성화 위해 off
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/preserve-caught-error': 'off',  // catch (e) 후 wrapping pattern 흔함
      // HMR boundary — admin tabs 들이 상수랑 같이 export 하는 경우 흔함
      'react-refresh/only-export-components': ['warn', {
        allowConstantExport: true,
      }],
    },
  },

  // Edge functions / scripts 가 import 한 코드는 위 매칭에서 제외됨
);
