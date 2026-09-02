/**
 * AiClassificationPanel — 'AI 분류' 통합 화면 (ADMIN-MERGE-AI-1)
 *
 * 장르 / 무드 / 매장유형 예측이 각각 별도 탭이었다. 셋은 같은 일을 필드만 바꿔 하는
 * 화면이라(CLAP zero-shot 예측을 artist 입력과 비교해 1-click 적용) 메뉴에서 셋을
 * 구분해 기억할 이유가 없다. 어떤 필드를 볼지는 화면 안에서 고른다.
 *
 * 각 패널의 적용 로직은 필드마다 다르므로(genre 는 main_genre, mood 는 mood+mood_tags 등)
 * 합치지 않고 그대로 재사용한다.
 */
import { lazy } from 'react';
import { Sparkles } from 'lucide-react';
import AdminMergedPanel from './AdminMergedPanel';

const GenrePredictionPanel = lazy(() => import('./GenrePredictionPanel'));
const MoodPredictionPanel = lazy(() => import('./MoodPredictionPanel'));
const StoreTypePredictionPanel = lazy(() => import('./StoreTypePredictionPanel'));

export default function AiClassificationPanel({ initialView }: { initialView?: string }) {
  return (
    <AdminMergedPanel
      initialView={initialView}
      views={[
        { key: 'genre', label: '장르', hint: 'AI 장르 예측 비교·적용',
          icon: <Sparkles size={13} />, render: () => <GenrePredictionPanel /> },
        { key: 'mood', label: '무드', hint: 'AI 무드 예측 비교·적용(태그 포함)',
          icon: <Sparkles size={13} />, render: () => <MoodPredictionPanel /> },
        { key: 'storetype', label: '매장 유형', hint: 'AI 매장 유형 예측 비교·적용',
          icon: <Sparkles size={13} />, render: () => <StoreTypePredictionPanel /> },
      ]}
    />
  );
}
