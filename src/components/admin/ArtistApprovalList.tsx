import { useCallback, useMemo, useState } from 'react';
import { Mic2, Clock, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { repairArtistSignups } from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import {
  AdminBadge, AdminButton, AdminEmpty, AdminTable, FilterBar, ConfirmDialog,
  type AdminTableColumn, type AdminToneName,
} from './ui';

interface ArtistRow {
  user_id: string;
  real_name: string;
  artist_name: string;
  phone: string;
  email: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  rejected_reason: string | null;
  created_at: string;
}

type StatusKey = ArtistRow['approval_status'];

const STATUS_LABEL: Record<StatusKey, { label: string; tone: AdminToneName }> = {
  pending: { label: '심사 대기', tone: 'warning' },
  approved: { label: '승인됨', tone: 'success' },
  rejected: { label: '거절됨', tone: 'danger' },
};

const FILTERS: Array<{ key: '' | StatusKey; label: string }> = [
  { key: '', label: '전체' },
  { key: 'pending', label: '심사 대기' },
  { key: 'approved', label: '승인됨' },
  { key: 'rejected', label: '거절됨' },
];

/** 한 번에 받아오는 상한. 검색·필터가 이 범위 안에서만 동작한다는 표시에 쓴다. */
const FETCH_LIMIT = 100;

type Pending =
  | { kind: 'approve'; row: ArtistRow }
  | { kind: 'reject'; row: ArtistRow }
  | { kind: 'repair' };

export default function ArtistApprovalList() {
  const [rows, setRows] = useState<ArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_pending_artists', { p_limit: FETCH_LIMIT });
      if (error) throw error;
      setRows((data ?? []) as ArtistRow[]);
    } catch (e) {
      toast.error(friendlyError(e, '아티스트 목록 로드 실패'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFreshFetch(load, []);

  async function approve(userId: string) {
    setBusyId(userId);
    try {
      const { error } = await supabase.rpc('approve_artist_profile', { p_user_id: userId });
      if (error) throw error;
      toast.success('승인 완료');
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '승인 실패'));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(userId: string, reason: string) {
    setBusyId(userId);
    try {
      const { error } = await supabase.rpc('reject_artist_profile', {
        p_user_id: userId,
        p_reason: reason,
      });
      if (error) throw error;
      toast.success('거절 완료');
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '거절 실패'));
    } finally {
      setBusyId(null);
    }
  }

  const [syncing, setSyncing] = useState(false);

  async function onRepair() {
    setSyncing(true);
    try {
      const res = await repairArtistSignups();
      if (!res.ok) {
        toast.error(res.error ?? '동기화 실패');
        return;
      }
      toast.success(
        `동기화 완료 — scanned ${res.scanned} · users_updated ${res.users_updated} · ` +
          `profiles_created ${res.profiles_created} · skipped ${res.skipped}`,
      );
      await load();
    } finally {
      setSyncing(false);
    }
  }

  // ── 검색/필터 — 전부 이미 받아온 rows 안에서만 계산한다(서버 재조회 없음).
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | StatusKey>('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.approval_status !== status) return false;
      if (!q) return true;
      return (
        r.artist_name?.toLowerCase().includes(q) ||
        r.real_name?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, status]);

  const pendingCount = rows.filter((r) => r.approval_status === 'pending').length;
  const activeFilters = (search.trim() ? 1 : 0) + (status ? 1 : 0);
  const atLimit = rows.length >= FETCH_LIMIT;

  // ── 확인 단계 — 승인/거절/동기화는 되돌리기 어렵다.
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const closeConfirm = () => {
    setConfirm(null);
    setRejectReason('');
  };

  const runConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === 'approve') void approve(confirm.row.user_id).finally(closeConfirm);
    else if (confirm.kind === 'reject')
      void reject(confirm.row.user_id, rejectReason).finally(closeConfirm);
    else void onRepair().finally(closeConfirm);
  };

  const confirmPending =
    confirm?.kind === 'repair' ? syncing : confirm ? busyId === confirm.row.user_id : false;

  const columns: AdminTableColumn<ArtistRow>[] = [
    {
      key: 'artist',
      header: '아티스트',
      cell: (r) => (
        <>
          <p className="font-medium">{r.artist_name}</p>
          <p className="text-xs text-ink-mute">{r.real_name}</p>
        </>
      ),
    },
    {
      key: 'contact',
      header: '연락처',
      tdClassName: 'text-xs text-ink-mute',
      cell: (r) => (
        <>
          {r.email}
          <br />
          <span className="text-ink-dim">{r.phone}</span>
        </>
      ),
    },
    {
      key: 'status',
      header: '상태',
      cell: (r) => {
        const s = STATUS_LABEL[r.approval_status] ?? STATUS_LABEL.pending;
        return (
          <>
            <AdminBadge
              tone={s.tone}
              variant="subtle"
              size="sm"
              icon={r.approval_status === 'pending' ? <Clock size={9} /> : undefined}
            >
              {s.label}
            </AdminBadge>
            {r.rejected_reason && (
              <p className="mt-1 text-[10px] text-ink-mute">{r.rejected_reason}</p>
            )}
          </>
        );
      },
    },
    {
      key: 'created',
      header: '가입일',
      align: 'right',
      tdClassName: 'text-xs text-ink-mute',
      cell: (r) =>
        new Date(r.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
    },
    {
      key: 'actions',
      header: '조치',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.approval_status !== 'approved' && (
            <AdminButton
              tone="success"
              variant="subtle"
              size="sm"
              disabled={busyId === r.user_id}
              onClick={() => setConfirm({ kind: 'approve', row: r })}
            >
              승인
            </AdminButton>
          )}
          {r.approval_status !== 'rejected' && (
            <AdminButton
              tone="danger"
              variant="subtle"
              size="sm"
              disabled={busyId === r.user_id}
              onClick={() => setConfirm({ kind: 'reject', row: r })}
            >
              거절
            </AdminButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Mic2 size={16} className="text-accent" /> 아티스트 승인
          </h2>
          <p className="text-xs text-ink-mute">심사 대기 {pendingCount}건</p>
        </div>
        <AdminButton
          tone="neutral"
          variant="outline"
          size="sm"
          loading={syncing}
          disabled={syncing}
          leftIcon={<RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />}
          onClick={() => setConfirm({ kind: 'repair' })}
          title="아직 artist_profiles 가 생성되지 않은 기존 가입자를 백필합니다 (멱등)"
        >
          {syncing ? '동기화 중…' : '누락된 아티스트 신청 동기화'}
        </AdminButton>
      </div>

      <FilterBar
        search={
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="아티스트명 · 실명 · 이메일 검색"
            aria-label="아티스트 검색"
            className="input w-full text-sm"
          />
        }
        filters={FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            type="button"
            onClick={() => setStatus(f.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
              status === f.key
                ? 'bg-accent/15 text-accent ring-accent/30'
                : 'text-ink-dim ring-line/15 hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
        activeCount={activeFilters}
        onReset={() => {
          setSearch('');
          setStatus('');
        }}
        count={
          activeFilters
            ? `${visible.length}건 / 불러온 ${rows.length}건${atLimit ? ` (상한 ${FETCH_LIMIT})` : ''}`
            : `${rows.length}건${atLimit ? ` (상한 ${FETCH_LIMIT})` : ''}`
        }
      />

      <AdminTable
        caption="아티스트 승인 신청 목록"
        columns={columns}
        rows={visible}
        rowKey={(r) => r.user_id}
        loading={loading}
        minWidth={720}
        empty={
          <AdminEmpty
            title={activeFilters ? '조건에 맞는 신청이 없어요.' : '아티스트 신청이 없어요.'}
          />
        }
      />

      <ConfirmDialog
        open={confirm?.kind === 'approve'}
        title="아티스트 승인"
        target={confirm?.kind === 'approve' ? confirm.row.artist_name : undefined}
        description="승인하면 이 아티스트는 음원을 업로드할 수 있게 됩니다."
        confirmLabel="승인"
        pending={confirmPending}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />

      <ConfirmDialog
        open={confirm?.kind === 'reject'}
        title="아티스트 거절"
        target={confirm?.kind === 'reject' ? confirm.row.artist_name : undefined}
        description="거절 사유는 아티스트에게 그대로 보입니다. 비워 두면 사유 없이 거절됩니다."
        confirmLabel="거절"
        destructive
        pending={confirmPending}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
          aria-label="거절 사유"
          placeholder="거절 사유 (선택)"
          className="input w-full text-sm"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'repair'}
        title="누락된 아티스트 신청 동기화"
        description="기존 가입자 중 artist_profiles 가 누락된 행을 일괄 보정합니다. 이미 승인/거절된 상태는 덮어쓰지 않습니다."
        confirmLabel="동기화"
        pending={confirmPending}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
