// Phase ALGO-6C — Feedback History & Longitudinal Trend (Shadow) API 래퍼.
// 0438 admin RPC 경유. History · Trend · Rolling Stats · Evolution · Forecast · Regression — 운영 미반영.
import { supabase } from './supabase';

export interface TimelinePoint {
  at: string; version: string | null; accuracy: number | null; risk: number | null;
  confidence: number | null; drift: number | null; promotion: number | null; state: string | null;
}
export interface TrendItem {
  trend: string; direction: string; slope: number | null; delta: number | null;
  start: number | null; end: number | null;
}
export interface WindowStat {
  window: string; metric: string; mean: number | null; std: number | null;
  best: number | null; worst: number | null; n: number;
}
export interface StabilityPoint { at: string; status: string; transition: string; accuracy: number | null }
export interface EvolutionItem {
  version: string; accuracy: number | null; risk: number | null; reward: number | null;
  confidence: number | null; drift: number | null; accuracy_delta: number | null;
}
export interface ForecastItem {
  horizon: number; metric: string; last: number | null; forecast: number | null; trend: string;
}
export interface RegressionItem {
  metric: string; type: string; severity: string; from: number | null; to: number | null; delta: number | null;
}

export interface FeedbackHistoryOverview {
  has_data: boolean;
  snapshot_batch?: string | null;
  timeline?: TimelinePoint[];
  trends?: TrendItem[];
  window_stats?: WindowStat[];
  stability_timeline?: StabilityPoint[];
  model_evolution?: EvolutionItem[];
  forecasts?: ForecastItem[];
  regressions?: RegressionItem[];
  promotion_history?: Array<{ at: string; score: number | null; state: string | null; candidate: boolean }>;
}

export interface HistoryResult { ok: boolean; snapshot_batch: string; snapshots: number }
export interface TrendResult { ok: boolean; snapshot_batch: string; trends: number; points: number; regressions: number }

export async function adminGenerateFeedbackHistory(points = 10, stepDays = 3, window = 21, lag = 5): Promise<HistoryResult> {
  const { data, error } = await supabase.rpc('admin_generate_feedback_history', { p_points: points, p_step_days: stepDays, p_window: window, p_lag: lag });
  if (error) throw error;
  return data as HistoryResult;
}

export async function adminGenerateLongitudinalTrend(batch: string | null = null): Promise<TrendResult> {
  const { data, error } = await supabase.rpc('admin_generate_longitudinal_trend', { p_batch: batch });
  if (error) throw error;
  return data as TrendResult;
}

export async function adminGenerateWindowStatistics(batch: string | null = null): Promise<{ ok: boolean; rows: number }> {
  const { data, error } = await supabase.rpc('admin_generate_window_statistics', { p_batch: batch });
  if (error) throw error;
  return data as { ok: boolean; rows: number };
}

export async function adminGenerateModelEvolution(batch: string | null = null): Promise<{ ok: boolean; evolution: EvolutionItem[] }> {
  const { data, error } = await supabase.rpc('admin_generate_model_evolution', { p_batch: batch });
  if (error) throw error;
  return data as { ok: boolean; evolution: EvolutionItem[] };
}

export async function adminGenerateDecisionForecast(batch: string | null = null): Promise<{ ok: boolean; forecasts: ForecastItem[] }> {
  const { data, error } = await supabase.rpc('admin_generate_decision_forecast', { p_batch: batch });
  if (error) throw error;
  return data as { ok: boolean; forecasts: ForecastItem[] };
}

export async function adminAiFeedbackHistoryOverview(): Promise<FeedbackHistoryOverview> {
  const { data, error } = await supabase.rpc('admin_ai_feedback_history_overview');
  if (error) throw error;
  return data as FeedbackHistoryOverview;
}
