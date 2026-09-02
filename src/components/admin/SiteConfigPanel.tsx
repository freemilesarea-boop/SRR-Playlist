/**
 * SiteConfigPanel — '사이트 설정' 통합 화면 (ADMIN-MERGE-SITE-1)
 *
 * '브랜드 로고'는 로고 이미지 하나를 올리는 화면인데 1차 메뉴에 독립 탭으로 있었다.
 * 사이트 전역 설정의 일부이므로 사이트 설정 안으로 넣는다.
 */
import { lazy } from 'react';
import { Settings, Image as ImageIcon } from 'lucide-react';
import AdminMergedPanel from './AdminMergedPanel';

const SiteSettingsPanel = lazy(() => import('./SiteSettingsPanel'));
const BrandSettingsPanel = lazy(() => import('./BrandSettingsPanel'));

export default function SiteConfigPanel({ initialView }: { initialView?: string }) {
  return (
    <AdminMergedPanel
      initialView={initialView}
      views={[
        { key: 'settings', label: '일반', hint: '사이트 전역 설정',
          icon: <Settings size={13} />, render: () => <SiteSettingsPanel /> },
        { key: 'brand', label: '브랜드 로고', hint: '로고 이미지 업로드·교체',
          icon: <ImageIcon size={13} />, render: () => <BrandSettingsPanel /> },
      ]}
    />
  );
}
