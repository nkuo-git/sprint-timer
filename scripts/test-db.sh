#!/usr/bin/env bash
# 在本機的 PostgreSQL 建一個暫時的資料庫，套用 supabase/migrations 後跑權限測試。
# 需要能用 psql 以超級使用者連線：設定 PGHOST / PGUSER / PGPASSWORD，或 sudo -u postgres bash scripts/test-db.sh。
set -euo pipefail
cd "$(dirname "$0")/.."
DB="sprint_timer_test_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB"' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/stub_auth.sql
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
# 只留下每一項的結果（ok - …），其餘查詢輸出丟掉；有任何一項失敗 psql 會以非 0 結束
psql -v ON_ERROR_STOP=1 -q -d "$DB" -o /dev/null -f supabase/tests/rls_test.sql 2>&1 | sed -E 's/^psql:[^ ]+ NOTICE:  //'
