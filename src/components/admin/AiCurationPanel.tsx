// AiCurationPanel — AI 큐레이션 관리 탭 라우터 (X6.49 분할 후 thin shell)
//
// 23개 sub-tab 을 dispatch 만 담당. 각 탭 구현은 다음 위치:
//   - src/components/admin/aiCuration/*.tsx — 본 패널 전용 14개 tab
//   - src/components/admin/{QcQueueTab,BehaviorTab,BehaviorInsightTab,StoreLearningTab,
//       EventQualityTab,GenreGuardrailTab,FeedbackSummaryTab,MdPolicyTab,AbuseMonitorTab,
//       StoreGenrePolicyTab}.tsx — 다른 위치에서도 재사용되는 9개 tab
//
// 공유 유틸은 src/components/admin/aiCuration/shared.tsx.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import PendingTab from '@/components/admin/aiCuration/PendingTab';
import ResultsTab from '@/components/admin/aiCuration/ResultsTab';
import FitTab from '@/components/admin/aiCuration/FitTab';
import UnifiedViolationsTab from '@/components/admin/aiCuration/UnifiedViolationsTab';
import PerformanceTab from '@/components/admin/aiCuration/PerformanceTab';
import EmbeddingTab from '@/components/admin/aiCuration/EmbeddingTab';
import EmbeddingReviewTab from '@/components/admin/aiCuration/EmbeddingReviewTab';
import GuardrailDashboardTab from '@/components/admin/aiCuration/GuardrailDashboardTab';
import HighRiskTab from '@/components/admin/aiCuration/HighRiskTab';
import RereviewTab from '@/components/admin/aiCuration/RereviewTab';
import FlowTab from '@/components/admin/aiCuration/FlowTab';
import ReorderTab from '@/components/admin/aiCuration/ReorderTab';
import BusinessReactionTab from '@/components/admin/aiCuration/BusinessReactionTab';
import DuplicateDetectionTab from '@/components/admin/aiCuration/DuplicateDetectionTab';
import AdminLearningTab from '@/components/admin/aiCuration/AdminLearningTab';
import WeightTuningTab from '@/components/admin/aiCuration/WeightTuningTab';
import AiRuntimePreviewTab from '@/components/admin/aiCuration/AiRuntimePreviewTab';
import AiRuntimeControlTab from '@/components/admin/aiCuration/AiRuntimeControlTab';

import QcQueueTab from '@/components/admin/QcQueueTab';
import BehaviorTab from '@/components/admin/BehaviorTab';
import BehaviorInsightTab from '@/components/admin/BehaviorInsightTab';
import StoreLearningTab from '@/components/admin/StoreLearningTab';
import EventQualityTab from '@/components/admin/EventQualityTab';
import GenreGuardrailTab from '@/components/admin/GenreGuardrailTab';
import FeedbackSummaryTab from '@/components/admin/FeedbackSummaryTab';
import MdPolicyTab from '@/components/admin/MdPolicyTab';
import AbuseMonitorTab from '@/components/admin/AbuseMonitorTab';
import StoreGenrePolicyTab from '@/components/admin/StoreGenrePolicyTab';

type SubTab = 'perf' | 'pending' | 'results' | 'fit' | 'review' | 'embedding' | 'embed_review'
  | 'guardrail' | 'genre_guardrail' | 'md_policy' | 'abuse_monitor' | 'highrisk' | 'rereview'
  | 'flow' | 'reorder' | 'business' | 'duplicates' | 'qc_queue' | 'behavior' | 'behavior_insight'
  | 'store_learning' | 'event_quality' | 'feedback_summary' | 'store_genre_policy' | 'admin_learning'
  | 'weight_tuning' | 'runtime_preview' | 'runtime_control';

const TABS: [SubTab, string][] = [
  ['perf', '운영 성과'],
  ['runtime_control', '🎛️ AI 런타임 제어'],
  ['runtime_preview', '🧪 AI 런타임 프리뷰'],
  ['admin_learning', '🧠 검수 패턴 학습'],
  ['weight_tuning', '⚖️ 가중치 튜닝'],
  ['store_genre_policy', '매장 장르 정책 (v1)'],
  ['qc_queue', 'AI 검수 큐'],
  ['behavior', '행동 지표'],
  ['behavior_insight', '행동 인사이트'],
  ['store_learning', '매장 학습'],
  ['event_quality', '이벤트 품질'],
  ['pending', '분석 대기'],
  ['results', 'AI 판정 결과'],
  ['fit', '플레이리스트 적합도'],
  ['review', '위반/검토 후보'],
  ['guardrail', 'Guardrail 대시보드'],
  ['genre_guardrail', '장르 가드레일'],
  ['md_policy', '매장 장르 정책 (MD)'],
  ['abuse_monitor', '어뷰징 모니터'],
  ['feedback_summary', '운영자 학습'],
  ['highrisk', '고위험 검수'],
  ['rereview', '전체 재검수'],
  ['flow', 'Playlist Flow'],
  ['reorder', '자동 재배치'],
  ['business', '사업자 반응'],
  ['duplicates', '중복 음원 탐지'],
  ['embed_review', '임베딩 검증'],
  ['embedding', '임베딩(PoC)'],
];

export default function AiCurationPanel() {
  const [sub, setSub] = useState<SubTab>('perf');
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Sparkles size={18} className="text-accent" /> AI 큐레이션 (v1)
        </h2>
        <p className="text-xs text-ink-mute">
          오디오 피처 분석 + 규칙 기반 AI 판정으로 매장/시간대 적합도를 계산합니다. (analyzer/version 기록 — 추후 ML 고도화)
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${sub === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'perf' && <PerformanceTab />}
      {sub === 'runtime_control' && <AiRuntimeControlTab />}
      {sub === 'runtime_preview' && <AiRuntimePreviewTab />}
      {sub === 'admin_learning' && <AdminLearningTab />}
      {sub === 'weight_tuning' && <WeightTuningTab />}
      {sub === 'pending' && <PendingTab />}
      {sub === 'results' && <ResultsTab />}
      {sub === 'fit' && <FitTab />}
      {sub === 'review' && <UnifiedViolationsTab />}
      {sub === 'embedding' && <EmbeddingTab />}
      {sub === 'embed_review' && <EmbeddingReviewTab />}
      {sub === 'guardrail' && <GuardrailDashboardTab />}
      {sub === 'genre_guardrail' && <GenreGuardrailTab />}
      {sub === 'md_policy' && <MdPolicyTab />}
      {sub === 'abuse_monitor' && <AbuseMonitorTab />}
      {sub === 'feedback_summary' && <FeedbackSummaryTab />}
      {sub === 'highrisk' && <HighRiskTab />}
      {sub === 'rereview' && <RereviewTab />}
      {sub === 'flow' && <FlowTab />}
      {sub === 'reorder' && <ReorderTab />}
      {sub === 'business' && <BusinessReactionTab />}
      {sub === 'duplicates' && <DuplicateDetectionTab />}
      {sub === 'qc_queue' && <QcQueueTab />}
      {sub === 'behavior' && <BehaviorTab />}
      {sub === 'behavior_insight' && <BehaviorInsightTab />}
      {sub === 'store_learning' && <StoreLearningTab />}
      {sub === 'event_quality' && <EventQualityTab />}
      {sub === 'store_genre_policy' && <StoreGenrePolicyTab />}
    </div>
  );
}
