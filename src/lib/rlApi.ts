// Phase ALGO-5B — Multi-Model Ensemble & Reinforcement Learning (Shadow) API 래퍼.
// 0435 admin RPC 경유. Reward/Bandit/Ensemble/Tournament/Store Personalization — 운영 미반영.
import { supabase } from './supabase';

export interface RewardStore {
  store: string; reward: number; completion: number; skip: number;
}
export interface RewardIndustry { industry: string; reward: number }
export interface RewardTop {
  track_id: string; reward: number; completion: number; exposure: number; confidence: number; decay: number;
}

export interface BanditArm { arm: string; value: number; pulls: number }
export interface BanditAlgorithm { algorithm: string; selected: string }
export interface StoreProfile { store: string; top_model: string }

export interface EnsembleEntry { key: string; type: string; blended: number | null }

export interface EloEntry {
  model: string; elo: number; wins: number; losses: number; win_rate: number; promotion_score: number;
}

export interface RlOverview {
  has_data: boolean;
  reward?: {
    reward_run_id: string | null; track_count: number; avg_reward: number | null; cold_start: number;
    stores: RewardStore[]; industries: RewardIndustry[];
  };
  bandit?: {
    bandit_run_id: string | null; arms: BanditArm[]; algorithms: BanditAlgorithm[]; store_profiles: StoreProfile[];
  };
  ensembles?: EnsembleEntry[];
  tournament?: { tournament_id: string | null; matches: number; elo: EloEntry[] };
}

export interface RewardResult { ok: boolean; reward_run_id: string; tracks: number; stores: number; industries: number; contexts: number }
export interface BanditResult { ok: boolean; bandit_run_id: string; reward_run_id: string; arms: number; rankings: number; store_profiles: number; algorithms: number }
export interface EnsembleResult { ok: boolean; ensemble_id: string; ensemble_key: string; ensemble_type: string; members: number; blended_score: number }
export interface TournamentResult { ok: boolean; tournament_id: string; format: string; matches: number; rounds: number; ranking: EloEntry[] }

export type EnsembleType = 'weighted' | 'voting' | 'stacking' | 'dynamic';
export type TournamentFormat = 'round_robin' | 'best_of_n';

export async function adminGenerateRewardMemory(days = 120, trackLimit = 200): Promise<RewardResult> {
  const { data, error } = await supabase.rpc('admin_generate_reward_memory', { p_days: days, p_track_limit: trackLimit });
  if (error) throw error;
  return data as RewardResult;
}

export async function adminRunBanditShadow(rewardRunId: string | null = null): Promise<BanditResult> {
  const { data, error } = await supabase.rpc('admin_run_bandit_shadow', { p_reward_run_id: rewardRunId });
  if (error) throw error;
  return data as BanditResult;
}

export async function adminGenerateEnsemble(ensembleType: EnsembleType = 'weighted', modelType = 'prediction'): Promise<EnsembleResult> {
  const { data, error } = await supabase.rpc('admin_generate_ensemble', { p_ensemble_type: ensembleType, p_model_type: modelType });
  if (error) throw error;
  return data as EnsembleResult;
}

export async function adminRunModelTournament(format: TournamentFormat = 'round_robin', modelType = 'prediction', bestOf = 3): Promise<TournamentResult> {
  const { data, error } = await supabase.rpc('admin_run_model_tournament', { p_format: format, p_model_type: modelType, p_best_of: bestOf });
  if (error) throw error;
  return data as TournamentResult;
}

export async function adminAiRlOverview(): Promise<RlOverview> {
  const { data, error } = await supabase.rpc('admin_ai_rl_overview');
  if (error) throw error;
  return data as RlOverview;
}
