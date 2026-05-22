import { create } from 'zustand';
import { supabaseProjectRef } from '@/lib/supabase';

export type UploadStepStatus = 'start' | 'ok' | 'error' | 'warn' | 'info';

export interface UploadDebugStep {
  stage: string;
  status: UploadStepStatus;
  detail?: string;
  at: number;
}

export interface FileMeta {
  name: string;
  size: number;
  type: string;
}

export interface UploadDebugRecord {
  projectRef: string;
  startedAt: number;
  title?: string;
  audio?: FileMeta | null;
  cover?: FileMeta | null;
  steps: UploadDebugStep[];
  audioStatus?: string;
  coverStatus?: string;
  rpcStatus?: string;
  trackId?: string;
  coverUrl?: string | null;
  releaseStatus?: string | null;
  error?: string;
  done: boolean;
  ok?: boolean;
}

interface UploadDebugState {
  record: UploadDebugRecord | null;
  begin: (init: { title?: string; audio?: FileMeta | null; cover?: FileMeta | null }) => void;
  step: (stage: string, status: UploadStepStatus, detail?: string) => void;
  patch: (p: Partial<UploadDebugRecord>) => void;
  finish: (p: Partial<UploadDebugRecord> & { ok: boolean }) => void;
  clear: () => void;
}

/**
 * 최근 1건의 음원 업로드 진행 상황(단계별)을 보관 — 관리자 Debug Panel 용.
 * 콘솔을 못 보는 운영자가 화면에서 바로 실패 단계를 확인할 수 있게 한다.
 */
export const useUploadDebugStore = create<UploadDebugState>((set) => ({
  record: null,
  begin: (init) =>
    set({
      record: {
        projectRef: supabaseProjectRef,
        startedAt: Date.now(),
        title: init.title,
        audio: init.audio ?? null,
        cover: init.cover ?? null,
        steps: [{ stage: 'started', status: 'start', at: Date.now() }],
        done: false,
      },
    }),
  step: (stage, status, detail) =>
    set((s) =>
      s.record
        ? { record: { ...s.record, steps: [...s.record.steps, { stage, status, detail, at: Date.now() }] } }
        : s,
    ),
  patch: (p) => set((s) => (s.record ? { record: { ...s.record, ...p } } : s)),
  finish: (p) =>
    set((s) => (s.record ? { record: { ...s.record, ...p, done: true } } : s)),
  clear: () => set({ record: null }),
}));

/** 비-React 컨텍스트(artistApi)에서 호출하기 위한 헬퍼 */
export const uploadDebug = {
  begin: (init: { title?: string; audio?: FileMeta | null; cover?: FileMeta | null }) =>
    useUploadDebugStore.getState().begin(init),
  step: (stage: string, status: UploadStepStatus, detail?: string) =>
    useUploadDebugStore.getState().step(stage, status, detail),
  patch: (p: Partial<UploadDebugRecord>) => useUploadDebugStore.getState().patch(p),
  finish: (p: Partial<UploadDebugRecord> & { ok: boolean }) =>
    useUploadDebugStore.getState().finish(p),
};
