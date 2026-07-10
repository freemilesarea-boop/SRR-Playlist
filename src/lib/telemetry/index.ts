// WEB-OPT-11 — Runtime Telemetry public facade.
//   Collection engine + pure aggregation. Client-side only (no DB/RPC/Storage — those are
//   forbidden this phase). Cross-user/historical persistence needs a server sink and is the
//   documented next step; this session's telemetry is surfaced in the Admin Runtime dashboard.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { recordRouteChange } from './collect';

export {
  initTelemetry,
  isTelemetryReady,
  getTelemetrySnapshot,
  clearTelemetry,
  recordRouteChange,
  recordInteraction,
  recordError,
  sampleMemory,
} from './collect';
export type {
  TelemetrySnapshot, DeviceProfile, VitalSample, LongTaskSample, ApiSample,
  RouteSample, InteractionSample, ErrorSample, MemorySample, ApiKind, ErrorKind,
} from './collect';
export type { Rating, VitalName, ApiSeverity } from './aggregate';

/**
 * Records route-change telemetry. Mount once under the Router. On each pathname change it logs
 * a RouteSample for the newly-entered route, with `duration` = dwell time on the previous route
 * (ms since the last navigation). Also updates the "current route" used to attribute long tasks
 * and errors. Pure read of `performance.now()` + a bounded ring push — negligible overhead.
 */
export function useRouteTelemetry(): void {
  const location = useLocation();
  const enterRef = useRef<number>(0);
  const startedRef = useRef<boolean>(false);
  useEffect(() => {
    let t = 0;
    try { t = performance.now(); } catch { /* noop */ }
    const dwell = startedRef.current ? Math.round(t - enterRef.current) : null;
    recordRouteChange(location.pathname, dwell);
    enterRef.current = t;
    startedRef.current = true;
  }, [location.pathname]);
}
