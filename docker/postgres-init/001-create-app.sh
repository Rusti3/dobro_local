#!/bin/sh
set -eu

if [ -z "${POSTGRES_APP_PASSWORD:-}" ]; then
  echo "POSTGRES_APP_PASSWORD is required" >&2
  exit 1
fi

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
create role dobrie_dela_app
  login
  password :'app_password'
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit;

revoke all on database dobrie_dela from public;
grant connect on database dobrie_dela to dobrie_dela_app;

revoke all on schema public from public;
create schema app authorization dobrie_dela_app;
alter role dobrie_dela_app in database dobrie_dela set search_path = app, public;
SQL
