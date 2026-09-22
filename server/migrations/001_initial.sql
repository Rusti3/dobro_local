create table if not exists app_users (
  id text primary key,
  name text not null,
  registered boolean not null default false,
  reminders boolean not null default false,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_id_not_blank check (length(id) > 0),
  constraint app_users_data_object check (jsonb_typeof(data) = 'object')
);

create table if not exists events (
  id text primary key,
  source text not null default 'dobro',
  source_url text,
  title text not null,
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  content_hash text,
  raw_data jsonb,
  catalog_data jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retired_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint events_catalog_object check (jsonb_typeof(catalog_data) = 'object'),
  constraint events_raw_object check (raw_data is null or jsonb_typeof(raw_data) = 'object')
);

create table if not exists event_cities (
  event_id text not null references events(id) on delete cascade,
  city text not null,
  last_seen_at timestamptz not null default now(),
  primary key (event_id, city)
);

create table if not exists vacancies (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  source_url text,
  title text,
  is_active boolean not null default true,
  input_hash text not null,
  raw_data jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retired_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint vacancies_raw_object check (jsonb_typeof(raw_data) = 'object')
);

create table if not exists event_annotations (
  vacancy_id text primary key references vacancies(id) on delete cascade,
  event_id text not null references events(id) on delete cascade,
  input_hash text not null,
  schema_version text not null,
  model text not null,
  quality_status text not null,
  review_required boolean not null default false,
  annotation jsonb not null,
  compact_annotation jsonb not null,
  annotated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotations_quality_status check (quality_status in ('suitable', 'clarification_required', 'hidden', 'human_review')),
  constraint annotations_payload_object check (jsonb_typeof(annotation) = 'object'),
  constraint annotations_compact_object check (jsonb_typeof(compact_annotation) = 'object')
);

create table if not exists annotation_jobs (
  vacancy_id text primary key references vacancies(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_jobs_status check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint annotation_jobs_attempts_nonnegative check (attempts >= 0)
);

create table if not exists plans (
  id uuid primary key,
  owner_id text not null references app_users(id) on delete cascade,
  event_id text not null references events(id),
  status text not null,
  when_at timestamptz,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_status check (status in ('draft', 'ready', 'done', 'cancelled')),
  constraint plans_data_object check (jsonb_typeof(data) = 'object')
);

create table if not exists plan_members (
  plan_id uuid not null references plans(id) on delete cascade,
  user_id text not null references app_users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create table if not exists invites (
  token text primary key,
  plan_id uuid not null references plans(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint invites_token_format check (token ~ '^[a-f0-9]{36}$')
);

create table if not exists service_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists sync_runs (
  id bigint generated always as identity primary key,
  kind text not null,
  status text not null,
  scope jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint sync_runs_status check (status in ('running', 'completed', 'failed', 'skipped')),
  constraint sync_runs_scope_object check (jsonb_typeof(scope) = 'object'),
  constraint sync_runs_counters_object check (jsonb_typeof(counters) = 'object')
);

create index if not exists events_active_ends_at_idx on events (ends_at, id) where is_active;
create index if not exists events_city_active_idx on events (city, ends_at) where is_active;
create index if not exists event_cities_city_seen_idx on event_cities (city, last_seen_at desc);
create index if not exists vacancies_event_active_idx on vacancies (event_id, is_active);
create index if not exists annotations_event_quality_idx on event_annotations (event_id, quality_status);
create index if not exists annotation_jobs_pending_idx on annotation_jobs (available_at, created_at) where status = 'pending';
create index if not exists plans_owner_status_idx on plans (owner_id, status, created_at desc);
create index if not exists plans_event_idx on plans (event_id);
create index if not exists plan_members_user_idx on plan_members (user_id, plan_id);
create index if not exists invites_plan_idx on invites (plan_id);
create index if not exists invites_expiry_idx on invites (expires_at);
create index if not exists sync_runs_kind_started_idx on sync_runs (kind, started_at desc);

