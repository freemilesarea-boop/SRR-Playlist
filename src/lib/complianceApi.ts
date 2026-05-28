/** complianceApi.ts — 아티스트 유통 컴플라이언스(계약/정산/결제/프로필) 감사. 관리자. */
import { supabase } from './supabase';

export interface ComplianceSummary {
  open_flags: number; flagged_tracks: number; flagged_artists: number;
  missing_contract: number; missing_payout: number; missing_payment: number; missing_profile: number;
  released_noncompliant: number; streamed_flagged: number; in_playlist_flagged: number; in_settlement_flagged: number;
}
export interface ComplianceFlagRow {
  id: string; track_id: string; user_id: string | null; artist_email: string | null; title: string | null;
  release_status: string | null; flag_type: string; severity: string; status: string; reason: string | null;
  detected_at: string; admin_note: string | null; has_stream: boolean; in_playlist: boolean; all_flags: string[];
}

export async function complianceSummary(): Promise<ComplianceSummary> {
  const { data, error } = await supabase.rpc('admin_compliance_summary');
  if (error) throw error; return data as ComplianceSummary;
}
export async function listComplianceFlags(filter = 'all', limit = 300): Promise<ComplianceFlagRow[]> {
  const { data, error } = await supabase.rpc('admin_list_compliance_flags', { p_filter: filter, p_limit: limit });
  if (error) throw error; return (data ?? []) as ComplianceFlagRow[];
}
export async function scanCompliance(): Promise<{ flags_upserted: number }> {
  const { data, error } = await supabase.rpc('admin_scan_track_compliance');
  if (error) throw error; return data as { flags_upserted: number };
}
export async function resolveComplianceFlag(trackId: string, status: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_compliance_flag', { p_track_id: trackId, p_status: status, p_note: note ?? null });
  if (error) throw error;
}
