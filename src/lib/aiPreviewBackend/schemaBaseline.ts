// AI-MUSIC-12 — Preview schema baseline strategy. The AI-MUSIC migrations (0464–0470) reference base schema
// (stores/auth/playlist/playback/telemetry/streaming/governance + `_is_super_admin()`), so a preview DB must be
// built from the FULL migration source with EMPTY data — never from a production dump/export. Pure.

import type { SchemaBaselineResult, SchemaBaselineStrategy } from './types';

export interface SchemaBaselineInput {
  aiMusicRequiresBaseSchema: boolean;    // 0464-0470 reference base tables/functions
  minimalSubsetProven: boolean;          // a minimal compatible subset has been proven safe
}

export function decideSchemaBaseline(i: SchemaBaselineInput): SchemaBaselineResult {
  // Default to the full migration source (empty data) — safest and drift-free. A minimal subset is only chosen
  // when it has been proven to satisfy every AI-MUSIC reference.
  const strategy: SchemaBaselineStrategy = i.aiMusicRequiresBaseSchema && !i.minimalSubsetProven
    ? 'FULL_SCHEMA_EMPTY_DATA'
    : (i.minimalSubsetProven ? 'MINIMAL_COMPATIBLE_SCHEMA' : 'FULL_SCHEMA_EMPTY_DATA');
  const reasons = [
    strategy === 'FULL_SCHEMA_EMPTY_DATA'
      ? '전체 Migration 을 순서대로 적용하고 Synthetic Fixture 만 생성 (Production 데이터 복사 없음)'
      : 'AI-MUSIC 참조를 만족하는 최소 Migration subset 적용 (의존성 명시, drift 검토)',
    'Production Dump/Row/Auth Export 사용 금지 — Migration source 우선',
  ];
  return { strategy, usesProductionDump: false, usesMigrationSource: true, reasons };
}
