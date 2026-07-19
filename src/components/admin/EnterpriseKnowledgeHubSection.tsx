/**
 * EnterpriseKnowledgeHubSection — Enterprise E-5 (Enterprise Knowledge Hub).
 *
 * Decision/Governance/Audit/Incident/Review/Policy/Executive Insight 를 조직의
 * 지식 자산으로 연결하는 Knowledge Layer.
 * 신규 Knowledge Engine/Search Engine/AI 모델/Migration/RPC 없음 — 기존 원장
 * (0479/0512/0502/0510/0503) 재사용(읽기 전용). AI 는 새로운 지식을 생성하지
 * 않으며, 기존 기록을 검색·연결·요약만 한다.
 * (기존 KnowledgeIntelligenceSection(AI-OPS-49)/KnowledgeEvolutionSection(0531)/
 *  AiMemoryKnowledgeSection(0498)/KnowledgeGraphSection(0513)과 별개, 미접촉)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, BookOpen, Bot, ClipboardList, Database, GitBranch,
  LayoutDashboard, Lock, RefreshCw, Search, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchActionHistory, fetchPolicyInventory, fetchIncidents, fetchRecoveryCandidates,
  fetchAccessReviews, fetchExecRecommendations,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  KNOWLEDGE_RELATIONSHIP_EDGES, KNOWLEDGE_SOURCES,
  assessKnowledgeQuality, buildKnowledgeOverview, buildKnowledgeRelationships,
  buildKnowledgeSummaryLines, emptyKnowledgeFeeds, normalizeKnowledgeItems, searchKnowledge,
  type KnowledgeFeeds, type KnowledgeSource,
} from '@/lib/enterpriseKnowledgeHub';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'decisions' | 'operations' | 'policies' | 'executive'
  | 'relationships' | 'search' | 'summary' | 'quality' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'decisions', label: 'Decisions', icon: ClipboardList },
  { key: 'operations', label: 'Operations', icon: Shield },
  { key: 'policies', label: 'Policies', icon: BookOpen },
  { key: 'executive', label: 'Executive', icon: Users },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'quality', label: 'Knowledge Quality', icon: Database },
  { key: 'limitations', label: 'Known Limitations', icon: Lock },
];

const KNOWN_LIMITATIONS = [
  '신규 Knowledge Engine/Search Engine/AI 모델 생성 없음 — 기존 기록을 연결·검색·요약하는 계층입니다',
  '신규 Migration/RPC/지식 저장소 없음 — 0479 Action Center/0512 Policy Registry/0502 Incident·Recovery/0510 Access Review/0503 Executive Recommendation 재사용(읽기 전용)',
  'AI 는 새로운 지식을 생성하지 않습니다 — 자동 Knowledge 생성/자동 Policy 생성은 금지 목록입니다',
  '검색은 이미 조회된 관측 창 내 기록에 대한 대소문자 무시 부분 문자열 매칭입니다 — 인덱스/임베딩/전문 검색 아님, 관측 창 밖 기록은 검색되지 않습니다',
  'AI Knowledge Summary 는 검색 결과 건수 기반 결정적 문장(5줄 이내)이며, 일치가 없으면 지식을 지어내지 않습니다',
  'Knowledge Coverage 는 관측 소스 비율(6종 중 관측 수)이며 지식의 완전성/정확성이 아닙니다',
  'Knowledge Quality: 미관측 insufficient_data / 관측 0건 partial / 전건 보관 archived / 그 외 available — 추론 없음',
  'Relationships 의 knowledge 단계는 별도 저장소가 없어 항상 미관측으로 표시됩니다(정직)',
  '자동 승인/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/자동 Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 원장 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

export default function EnterpriseKnowledgeHubSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [feeds, setFeeds] = useState<KnowledgeFeeds>(emptyKnowledgeFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<KnowledgeSource | ''>('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const keys = ['actionHistory', 'policies', 'incidents', 'recoveries', 'accessReviews', 'execRecommendations'] as const;
      const results = await Promise.allSettled([
        fetchActionHistory(100), fetchPolicyInventory(null, null, 200), fetchIncidents(null, null, 100),
        fetchRecoveryCandidates(null, null, 100), fetchAccessReviews(null, 100),
        fetchExecRecommendations(null, null, null, 100),
      ]);
      const next = emptyKnowledgeFeeds();
      const failed: string[] = [];
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value != null) (next as unknown as Record<string, unknown>)[k] = r.value;
        else failed.push(k);
      });
      setFeeds(next); setFailedFeeds(failed);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const normalized = useMemo(() => normalizeKnowledgeItems(feeds), [feeds]);
  const overview = useMemo(() => buildKnowledgeOverview(feeds), [feeds]);
  const relationships = useMemo(() => buildKnowledgeRelationships(feeds), [feeds]);
  const quality = useMemo(() => assessKnowledgeQuality(feeds), [feeds]);
  const searchResult = useMemo(
    () => searchKnowledge(normalized.items, query, sourceFilter === '' ? null : sourceFilter),
    [normalized, query, sourceFilter],
  );
  const summaryLines = useMemo(() => buildKnowledgeSummaryLines(searchResult), [searchResult]);

  if (loading) return <AdminCard title="Enterprise Knowledge Hub"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Knowledge Hub">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const itemsOf = (sources: KnowledgeSource[]) => normalized.items.filter((i) => sources.includes(i.source));
  const itemList = (sources: KnowledgeSource[], emptyText: string) => {
    const items = itemsOf(sources);
    return items.length === 0
      ? <AdminEmpty title="기록 없음" description={emptyText} />
      : (
        <div className="space-y-1">
          {items.slice(0, 30).map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone="neutral">{i.source}</AdminBadge>
                <span className="truncate text-xs font-bold">{i.title}</span>
                <span className="truncate text-[10px] text-muted-foreground">{i.detail}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{i.status} · {i.createdAt ? new Date(i.createdAt).toLocaleString('ko-KR') : '—'}{i.evidenceCount != null ? ` · evidence ${i.evidenceCount}` : ''}</span>
            </div>
          ))}
        </div>
      );
  };
  const qualityTone = (l: string) => (l === 'available' ? 'success' : l === 'partial' ? 'warning' : l === 'archived' ? 'neutral' : 'neutral') as 'success' | 'warning' | 'neutral';

  return (
    <AdminCard
      title="Enterprise Knowledge Hub"
      subtitle="Decision·Governance·Audit·Incident·Review·Policy·Executive 기록을 조직 지식으로 연결 — 검색·연결·요약만 (생성/추론 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 허브는 조직의 운영 경험과 의사결정 기록을 하나의 화면에서 검색·연결·요약하는 Knowledge Layer 입니다. 같은 실수를 반복하지 않기 위해 기존 기록을 참조 가능하게 할 뿐, AI 는 새로운 지식을 생성하지 않습니다. 신규 Knowledge Engine·Search Engine·AI 모델은 만들지 않았고, 자동 지식 생성·자동 Policy 생성·자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·자동 Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Total Knowledge" value={NUM(overview.totalKnowledge)} />
            <Box label="Decisions Indexed" value={NUM(overview.decisionsIndexed)} />
            <Box label="Reviews Indexed" value={NUM(overview.reviewsIndexed)} />
            <Box label="Incidents Indexed" value={NUM(overview.incidentsIndexed)} />
            <Box label="Policies Indexed" value={NUM(overview.policiesIndexed)} />
            <Box label="Audit Records" value={NUM(overview.auditRecords)} />
            <Box label="Executive Notes" value={NUM(overview.executiveNotes)} />
            <Box label="Knowledge Coverage (소스 관측률)" value={`${NUM(overview.knowledgeCoveragePct)}%`} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 해당 소스는 미관측으로만 표시됩니다(추론 없음).`} />
          )}
          <p className="text-[11px] text-muted-foreground">미관측 소스: {normalized.unobservedSources.join(', ') || '없음'} · Coverage 는 소스 관측률이며 지식 완전성이 아닙니다.</p>
        </div>
      )}

      {tab === 'decisions' && (
        <div className="space-y-2">
          {itemList(['decision'], 'decision_* 감사 기록이 관측되지 않았습니다.')}
          <p className="text-[11px] text-muted-foreground">Decision History/Reason(사유)/Result(status)/Evidence 는 0479 원장 그대로 — Related Decisions 는 Search 탭에서 검색으로 연결합니다.</p>
        </div>
      )}

      {tab === 'operations' && (
        <div className="space-y-2">
          {itemList(['incident', 'audit'], 'Incident/Recovery/Action 기록이 관측되지 않았습니다.')}
          <p className="text-[11px] text-muted-foreground">Incident History·Recovery History(0502) + Operational Reviews·Action History(0479) 통합 조회.</p>
        </div>
      )}

      {tab === 'policies' && (
        <div className="space-y-2">
          {itemList(['policy'], 'Policy Registry 가 관측되지 않았습니다.')}
          <p className="text-[11px] text-muted-foreground">기존 Policy(0512)만 조회합니다 — AI 는 Policy 를 생성하지 않습니다.</p>
        </div>
      )}

      {tab === 'executive' && (
        <div className="space-y-2">
          {itemList(['executive', 'review'], 'Executive/Review 기록이 관측되지 않았습니다.')}
          <p className="text-[11px] text-muted-foreground">Executive Reviews/Notes(0479 executive_*) + Executive Recommendation(0503) + Access Review(0510) 통합 조회.</p>
        </div>
      )}

      {tab === 'relationships' && (
        <div className="space-y-1">
          {relationships.map((r, i) => (
            <div key={r.stage}>
              <div className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{r.stage}</span>
                  <AdminBadge tone={r.observed ? 'success' : 'neutral'}>{r.observed ? '관측됨' : '미관측'}</AdminBadge>
                </div>
                <span className="text-[10px] text-muted-foreground">{i < KNOWLEDGE_RELATIONSHIP_EDGES.length ? KNOWLEDGE_RELATIONSHIP_EDGES[i].via : r.note}</span>
              </div>
              {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Incident→Review→Decision→Policy→Audit→Knowledge — 지식으로의 정리는 사람이 수행하며 자동 생성되지 않습니다.</p>
        </div>
      )}

      {tab === 'search' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="기존 기록 검색 (부분 문자열)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as KnowledgeSource | '')} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">전체 소스</option>
              {KNOWLEDGE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {searchResult.query === ''
            ? <AdminEmpty title="검색어 입력" description="이미 조회된 기존 기록(관측 창 내)에서 부분 문자열로 검색합니다 — 신규 검색 엔진 없음." />
            : searchResult.matches.length === 0
              ? <AdminEmpty title="일치 없음" description={`'${searchResult.query}' 와 일치하는 기존 기록이 없습니다 — 지식을 지어내지 않습니다.`} />
              : (
                <div className="space-y-1">
                  {searchResult.matches.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <AdminBadge tone="neutral">{m.source}</AdminBadge>
                        <span className="truncate text-xs font-bold">{m.title}</span>
                        <span className="truncate text-[10px] text-muted-foreground">{m.detail}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{m.status}</span>
                    </div>
                  ))}
                </div>
              )}
          <p className="text-[11px] text-muted-foreground">일치 {NUM(searchResult.totalMatches)}건{searchResult.countsBySource.length > 0 ? ` (${searchResult.countsBySource.map((c) => `${c.source} ${c.count}`).join(', ')})` : ''} · {searchResult.note}</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">Search 탭의 현재 검색 결과 건수 기반 결정적 요약(5줄 이내) — 판단/예측이 아니며, 일치가 없으면 지식을 지어내지 않습니다.</p>
        </div>
      )}

      {tab === 'quality' && (
        <div className="space-y-1">
          {quality.map((q) => (
            <div key={q.source} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(q.level)}>{q.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{q.source}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{q.itemCount == null ? q.note : `${NUM(q.itemCount)}건${q.archivedCount != null && q.archivedCount > 0 ? ` (보관 ${q.archivedCount})` : ''} · ${q.note}`}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Available/Partial/Archived/Insufficient Data — 없는 데이터를 추론하지 않습니다.</p>
        </div>
      )}

      {tab === 'limitations' && (
        <ul className="list-disc space-y-1 pl-4">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i} className="text-[11px] text-muted-foreground">{l}</li>)}
        </ul>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
