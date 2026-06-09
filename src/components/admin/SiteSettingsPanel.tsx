import { useEffect, useState } from 'react';
import { Bell, Save, ShieldOff, ShieldCheck, AlertTriangle } from 'lucide-react';
import { fetchSiteSettings, adminUpdateSiteSettings, type SiteSettings } from '@/lib/siteSettingsApi';
import { adminPurgeAllTracks, type PurgeAllResult } from '@/lib/adminTrackApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

export default function SiteSettingsPanel() {
  const [s, setS] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [lastPurge, setLastPurge] = useState<PurgeAllResult | null>(null);

  async function handlePurgeAll() {
    if (confirmText !== 'DELETE_ALL_TRACKS') {
      toast.error('확인 문구 정확히 입력해주세요');
      return;
    }
    if (!confirm(
      '⚠️ 모든 음원과 트랙 DB row 가 영구 삭제됩니다.\n\n' +
      '· 아티스트별 누적 스트리밍 수는 artist_lifetime_streams 에 자동 스냅샷 (보존)\n' +
      '· 정산/수익 기록 (streaming_revenues, settlement_items) 도 보존\n' +
      '· 음원 파일 (audio/cover) 도 storage 에서 제거\n' +
      '· 되돌릴 수 없습니다.\n\n계속할까요?',
    )) return;

    setPurging(true);
    try {
      const result = await adminPurgeAllTracks();
      setLastPurge(result);
      setConfirmText('');
      toast.success(
        `완료: 아티스트 스냅샷 ${result.snapshot_artists}, ` +
        `완전삭제 ${result.hard_deleted}, ` +
        `보존삭제 ${result.soft_deleted}, ` +
        `실패 ${result.failed}`,
      );
    } catch (e) {
      toast.error(friendlyError(e, '실행 실패'));
    } finally {
      setPurging(false);
    }
  }

  useEffect(() => {
    (async () => {
      const row = await fetchSiteSettings();
      setS(row);
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!s) return;
    if (s.notice_title.trim().length === 0 || s.notice_body.trim().length === 0) {
      toast.error('공지 제목/본문은 비울 수 없습니다');
      return;
    }
    setSaving(true);
    try {
      const updated = await adminUpdateSiteSettings({
        distribution_enabled: s.distribution_enabled,
        notice_enabled: s.notice_enabled,
        notice_title: s.notice_title,
        notice_body: s.notice_body,
      });
      setS(updated);
      toast.success('사이트 설정 저장 완료');
    } catch (e) {
      toast.error(friendlyError(e, '저장 실패'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>;
  if (!s) return <p className="py-8 text-center text-xs text-rose-400">설정을 불러올 수 없습니다.</p>;

  return (
    <section className="space-y-4">
      {/* 음원 유통 kill switch */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          {s.distribution_enabled ? (
            <ShieldCheck size={14} className="text-emerald-400" />
          ) : (
            <ShieldOff size={14} className="text-rose-400" />
          )}
          <h3 className="text-sm font-bold tracking-tight">신규 음원 유통 접수</h3>
          <span className="ml-auto text-[10px] text-ink-dim">
            DB 트리거 기반 — 일반 사용자는 RPC 호출도 차단됨
          </span>
        </div>

        <label className="flex items-start gap-3 rounded-lg bg-bg-soft p-3 ring-1 ring-line/10">
          <input
            type="checkbox"
            checked={s.distribution_enabled}
            onChange={(e) => setS({ ...s, distribution_enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {s.distribution_enabled ? '유통 접수 활성 (정상)' : '유통 접수 중지 중'}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-mute">
              체크 해제 시 신규 업로드 시도가 차단되고 사용자에게 안내 메시지가 표시됩니다.
              기존 등록 음원과 admin 작업에는 영향 없습니다.
            </p>
          </div>
        </label>
      </div>

      {/* 공지 팝업 설정 */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          <Bell size={14} className={s.notice_enabled ? 'text-accent' : 'text-ink-dim'} />
          <h3 className="text-sm font-bold tracking-tight">메인페이지 공지 팝업</h3>
          <label className="ml-auto flex items-center gap-2 text-[11px] text-ink-mute">
            <input
              type="checkbox"
              checked={s.notice_enabled}
              onChange={(e) => setS({ ...s, notice_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
            />
            {s.notice_enabled ? '표시 ON' : '표시 OFF'}
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">제목</span>
          <input
            type="text"
            value={s.notice_title}
            onChange={(e) => setS({ ...s, notice_title: e.target.value })}
            className="input text-sm"
            maxLength={100}
          />
        </label>

        <label className="mt-3 block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">본문</span>
          <textarea
            value={s.notice_body}
            onChange={(e) => setS({ ...s, notice_body: e.target.value })}
            className="input min-h-[160px] resize-y text-sm leading-relaxed"
            maxLength={2000}
          />
          <span className="text-[10px] text-ink-dim">{s.notice_body.length}/2000</span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="text-[10px] text-ink-dim">
          마지막 저장: {new Date(s.updated_at).toLocaleString()}
        </span>
        <button onClick={handleSave} disabled={saving} className="btn-primary h-9">
          <Save size={14} />
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>

      {/* 위험 영역: 전체 트랙 일괄 삭제 (스트리밍 카운트 보존) */}
      <div className="rounded-2xl bg-rose-500/5 p-4 ring-1 ring-rose-500/20">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-rose-400" />
          <h3 className="text-sm font-bold tracking-tight text-rose-300">위험 영역 — 전체 트랙 초기화</h3>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-mute">
          · 모든 음원과 트랙 DB row 가 영구 삭제됩니다 (storage 파일 포함).
          <br />· 아티스트별 누적 스트리밍 수는 <b>artist_lifetime_streams</b> 에 자동 스냅샷 → 보존.
          <br />· 정산/수익 기록 (<b>streaming_revenues</b>, <b>settlement_items</b>) 도 보존.
          <br />· 되돌릴 수 없습니다. 실행 전 확인 문구 입력 필요.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE_ALL_TRACKS"
            className="input h-9 flex-1 text-xs"
          />
          <button
            onClick={handlePurgeAll}
            disabled={purging || confirmText !== 'DELETE_ALL_TRACKS'}
            className="h-9 rounded-lg bg-rose-500/20 px-4 text-xs font-bold text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/30 disabled:opacity-40"
          >
            {purging ? '실행 중…' : '전체 트랙 삭제'}
          </button>
        </div>

        {lastPurge && (
          <div className="mt-3 rounded-lg bg-bg-card p-3 text-[11px]">
            <p className="font-semibold text-ink">최근 실행 결과</p>
            <ul className="mt-1 space-y-0.5 text-ink-mute">
              <li>· 아티스트 스냅샷: <b className="text-ink">{lastPurge.snapshot_artists}</b> 명</li>
              <li>· 대상 트랙: <b className="text-ink">{lastPurge.total_tracks}</b> 개</li>
              <li>· 완전 삭제 (정산 없음): <b className="text-emerald-400">{lastPurge.hard_deleted}</b></li>
              <li>· 보존 삭제 (정산 보호): <b className="text-amber-400">{lastPurge.soft_deleted}</b></li>
              <li>· 실패: <b className="text-rose-400">{lastPurge.failed}</b></li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
