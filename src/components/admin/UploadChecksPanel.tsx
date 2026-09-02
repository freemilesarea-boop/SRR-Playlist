/**
 * UploadChecksPanel — '업로드 점검' 통합 화면 (ADMIN-MERGE-UPLOAD-1)
 *
 * 업로드/스토리지 점검과 업로드 무결성이 별도 탭이었다. 둘 다 "업로드된 파일이
 * 성한가"를 보는 점검 도구이고, 무결성 쪽은 105줄짜리 단일 리포트라 탭 하나를
 * 차지할 이유가 없었다.
 */
import { lazy } from 'react';
import { HardDrive, ShieldCheck } from 'lucide-react';
import AdminMergedPanel from './AdminMergedPanel';

const UploadAuditPanel = lazy(() => import('./UploadAuditPanel'));
const UploadIntegrityPanel = lazy(() => import('./UploadIntegrityPanel'));

export default function UploadChecksPanel({ initialView }: { initialView?: string }) {
  return (
    <AdminMergedPanel
      initialView={initialView}
      views={[
        { key: 'audit', label: '스토리지 점검', hint: '업로드 파일·스토리지 상태 점검',
          icon: <HardDrive size={13} />, render: () => <UploadAuditPanel /> },
        { key: 'integrity', label: '무결성', hint: '업로드 무결성 검사 결과',
          icon: <ShieldCheck size={13} />, render: () => <UploadIntegrityPanel /> },
      ]}
    />
  );
}
