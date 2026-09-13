-- 0519a — 원격 복구 RPC 에서 anon EXECUTE 회수
--
-- Supabase 는 public 스키마 신규 함수에 default privileges 로 anon EXECUTE 를 붙인다.
-- 원격 복구 명령 계열은 anon 이 호출할 이유가 전혀 없다. 함수 내부 가드
-- (_is_super_admin / auth.uid() null 체크)가 이미 거부하지만, 표면 자체를 없앤다.

revoke all on function public.request_store_recovery(uuid, text, uuid, text, text) from anon;
revoke all on function public.ack_store_recovery(uuid, text, text, text, text) from anon;

-- 0518 에서 같은 이유로 열려 있던 것도 함께 닫는다.
revoke all on function public.admin_enqueue_brand_player_command(uuid, text, text) from anon;

notify pgrst, 'reload schema';
