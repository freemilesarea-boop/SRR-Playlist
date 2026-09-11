/**
 * nativeConsole.ts — 앱의 console 로그를 logcat 에서 읽을 수 있게 만든다.
 *
 * Capacitor 는 WebView 의 console 을 logcat 으로 넘겨주는데, 인자를 문자열로 합칠 때
 * 객체를 그냥 String() 한다. 그래서 이렇게 나온다:
 *
 *   Msg: [audio] metadata timeout — duration 0:00, 재생 불가 처리 [object Object]
 *
 * 정작 필요한 readyState · networkState · currentSrc 가 통째로 사라진다. 기기에서만
 * 나는 문제를 쫓을 때 이게 치명적이다 — 증상은 보이는데 상태를 볼 수가 없다.
 *
 * 그래서 네이티브에서만 console 을 한 겹 감싸서, 객체 인자를 JSON 으로 바꿔 넘긴다.
 * 웹은 건드리지 않는다(브라우저 devtools 는 객체를 펼쳐서 보여주므로 이 변환이
 * 오히려 손해다).
 */
import { isNativeApp } from '@/lib/native';

/** 한 인자가 로그에서 차지할 수 있는 최대 길이. 넘으면 자른다. */
const MAX_ARG_CHARS = 2000;

/**
 * 로그용 문자열로 바꾼다. 순환 참조·Error·너무 큰 객체를 모두 견뎌야 한다 —
 * 로그를 찍다가 예외가 나면 원래 쫓던 문제를 덮어버린다.
 */
export function toLogString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return String(value);

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  const seen = new WeakSet<object>();
  let out: string;
  try {
    out = JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    // toJSON 이 던지는 등 JSON 으로 못 만드는 값 — 최소한 타입은 남긴다.
    out = Object.prototype.toString.call(value);
  }

  if (out === undefined) return String(value);
  return out.length > MAX_ARG_CHARS ? `${out.slice(0, MAX_ARG_CHARS)}…(잘림)` : out;
}

let installed = false;

/**
 * console.log/info/warn/error 를 감싸 객체 인자를 JSON 으로 바꾼다.
 * 웹에서는 아무 것도 하지 않는다. 두 번 불러도 한 번만 적용된다.
 */
export function installNativeConsoleJson(): void {
  if (!isNativeApp() || installed) return;
  installed = true;

  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const name of methods) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      original(...args.map(toLogString));
    };
  }
}
