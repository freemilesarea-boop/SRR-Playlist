#!/usr/bin/env python3
"""
generated_embeddings.json → Supabase track_embeddings 임포트 (터미널 대안).
관리자 앱 UI 임포트가 기본 경로이며, 이 스크립트는 CLI 선호 시 사용.

보안: service_role key 는 환경변수에서만 읽음(하드코딩 금지).
  export SUPABASE_URL=...
  export SUPABASE_SERVICE_ROLE_KEY=...

사용:
  python import_embeddings.py generated_embeddings.json --dry-run   # 검증만
  python import_embeddings.py generated_embeddings.json             # 실제 임포트

검증: track_id(uuid) 존재, embedding 배열, embedding_dim == 길이. 실패 row 는 건너뛰고 사유 출력.
서버 RPC admin_import_track_embeddings(p_rows, p_dry_run) 를 호출하므로 검증 로직은 서버와 동일.
"""
import os
import sys
import json
import argparse


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="generated_embeddings.json")
    ap.add_argument("--dry-run", action="store_true", help="검증만(쓰기 X)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    with open(args.file, "r", encoding="utf-8") as f:
        rows = json.load(f)
    if isinstance(rows, dict) and isinstance(rows.get("embeddings"), list):
        rows = rows["embeddings"]
    if not isinstance(rows, list):
        print("ERROR: JSON 은 배열 또는 {embeddings:[...]} 형식이어야 합니다.", file=sys.stderr)
        return 2

    from supabase import create_client  # pip install supabase

    sb = create_client(url, key)
    # 서버 RPC 가 track_id/dim 검증 + 실패 row skip 처리 (단일 소스)
    res = sb.rpc(
        "admin_import_track_embeddings",
        {"p_rows": rows, "p_dry_run": bool(args.dry_run)},
    ).execute()
    data = res.data or {}
    print(json.dumps(data, ensure_ascii=False, indent=2))
    errs = data.get("errors") or []
    print(f"\n{'[DRY-RUN] ' if args.dry_run else ''}imported={data.get('imported')} skipped={data.get('skipped')} errors={len(errs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
