# 10 — Read-only Verification SQL (operator)

> Metadata-only. **No function execution, no user tables, no DDL/DML, no secrets.** Run against Test and Production; compare outputs. Column order fixed for diffing.

## A. Supabase SQL Editor / psql — existence + signature + security + grants
```sql
select
  p.proname,
  n.nspname                                   as schema,
  pg_get_function_identity_arguments(p.oid)   as identity_args,
  pg_get_function_result(p.oid)               as return_type,
  p.prosecdef                                 as security_definer,
  p.proconfig                                 as config,          -- expect {search_path=public}
  pg_get_userbyid(p.proowner)                 as owner,
  p.provolatile                               as volatility,
  md5(pg_get_functiondef(p.oid))              as source_hash,     -- hash only; never paste source
  case when p.proacl is null then array['PUBLIC(default)']
       else (select array_agg(distinct a.grantee::regrole::text order by a.grantee::regrole::text)
             from aclexplode(p.proacl) a where a.privilege_type='EXECUTE') end as execute_grants
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = any(array[
 'admin_delete_site_notice','admin_get_support_inquiry_detail','admin_hard_delete_track','admin_list_site_notices',
 'admin_list_support_inquiries','admin_purge_all_tracks','admin_support_inquiry_summary','admin_toggle_site_notice',
 'admin_update_inquiry','admin_update_site_settings','admin_update_track_metadata_full','admin_upsert_site_notice',
 'ai_correction_stats','ai_predictions_summary','apply_track_ai_predictions','bulk_apply_high_confidence_ai_predictions',
 'bulk_delete_severe_mismatches','create_support_inquiry','get_admin_track_detail','get_my_inquiry_detail',
 'get_site_settings','list_active_site_notices','list_admin_tracks_with_ai','list_clap_auto_approved',
 'list_clap_curation_playlists','list_clap_recommendations','list_my_inquiries','list_pending_ai_predictions',
 'list_severe_metadata_mismatches','rollback_clap_auto_attach','set_playlist_auto_attach'])
order by p.proname, identity_args;
```

## B. Dependency tables existence
```sql
select t.tbl, (to_regclass('public.'||t.tbl) is not null) as exists
from (values ('site_notices'),('site_settings'),('support_inquiries'),('support_inquiry_attachments'),
  ('track_ai_predictions'),('clap_recommendations'),('playlist_centroids')) as t(tbl)
order by t.tbl;
```

## C. Extract exact source for recovery (admin only; do NOT paste into reports)
```sql
select p.proname, pg_get_functiondef(p.oid) as def   -- capture into the migration file, review before commit
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname = any(array[ /* one cluster at a time */ ]);
```

Results this phase (executed via read-only MCP metadata query):
- **Query A** on Test → 0 rows (all 31 absent). On Production → 31 rows (all present).
- **Query B** → Test: only clap_recommendations/playlist_centroids exist; Production: all exist except track_metadata_corrections.
