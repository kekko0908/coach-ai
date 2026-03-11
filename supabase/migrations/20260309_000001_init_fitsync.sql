create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Utente',
  weight_kg numeric(6,2),
  heart_rate_max integer,
  target_steps integer not null default 8000,
  target_sleep_hours numeric(4,1) not null default 7.5,
  training_days integer not null default 4,
  preferred_split text,
  active_days text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.profile_heart_rate_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  zone text not null check (zone in ('Z1', 'Z2', 'Z3', 'Z4', 'Z5')),
  label text not null,
  min_bpm integer not null,
  max_bpm integer not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, zone)
);

create trigger profile_heart_rate_zones_set_updated_at
before update on public.profile_heart_rate_zones
for each row execute function public.set_updated_at();

create table if not exists public.profile_weekly_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  muscle_group text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, day_of_week, muscle_group)
);

create table if not exists public.coach_memory (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  primary_goal text not null check (primary_goal in ('fat_loss', 'hypertrophy', 'strength', 'performance', 'health')),
  main_sport text not null check (main_sport in ('gym', 'football', 'running', 'cycling', 'hybrid')),
  limitations text[] not null default '{}',
  injuries text[] not null default '{}',
  preferences text[] not null default '{}',
  coach_notes text[] not null default '{}',
  current_phase text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger coach_memory_set_updated_at
before update on public.coach_memory
for each row execute function public.set_updated_at();

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  thinker_mode boolean not null default false,
  current_general_chat_session_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('json', 'csv-folder', 'manual', 'gpx', 'tcx')),
  source_name text,
  status text not null default 'completed' check (status in ('pending', 'processing', 'completed', 'failed')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger import_batches_set_updated_at
before update on public.import_batches
for each row execute function public.set_updated_at();

create table if not exists public.health_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  bpm_baseline integer,
  hrv_ms integer,
  steps integer,
  calories numeric(10,2),
  sleep_deep_hours numeric(5,2),
  sleep_core_hours numeric(5,2),
  sleep_rem_hours numeric(5,2),
  sleep_total_hours numeric(5,2),
  sleep_awake_hours numeric(5,2),
  sleep_start timestamptz,
  sleep_stop timestamptz,
  sleep_efficiency numeric(5,2),
  source text not null default 'manual' check (source in ('json', 'csv-folder', 'manual')),
  imported_at timestamptz,
  hrv_available boolean not null default true,
  notes text[] not null default '{}',
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create trigger health_daily_set_updated_at
before update on public.health_daily
for each row execute function public.set_updated_at();

create table if not exists public.sleep_timeline_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  health_daily_id uuid not null references public.health_daily(id) on delete cascade,
  occurred_at timestamptz not null,
  stage text not null check (stage in ('deep', 'core', 'rem', 'awake')),
  stage_label text,
  stage_value integer,
  heart_rate integer,
  respiratory_rate numeric(6,2),
  created_at timestamptz not null default now()
);

create table if not exists public.heart_rate_intraday_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  health_daily_id uuid not null references public.health_daily(id) on delete cascade,
  occurred_at timestamptz not null,
  heart_rate integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.steps_hourly_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  health_daily_id uuid not null references public.health_daily(id) on delete cascade,
  hour_of_day smallint not null check (hour_of_day between 0 and 23),
  steps integer not null default 0,
  created_at timestamptz not null default now(),
  unique (health_daily_id, hour_of_day)
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workout_date date not null,
  title text,
  type text check (type in ('workout', 'running', 'football', 'cycling', 'other')),
  source_sport_code integer,
  source_sport_label text,
  duration_minutes integer,
  calories_burned integer,
  average_heart_rate integer,
  gpx_storage_path text,
  tcx_storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workouts_set_updated_at
before update on public.workouts
for each row execute function public.set_updated_at();

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_order integer not null default 0,
  name text not null,
  sets integer not null default 0,
  reps integer not null default 0,
  rest_seconds integer not null default 0,
  weight_kg numeric(8,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exercise_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger personal_records_set_updated_at
before update on public.personal_records
for each row execute function public.set_updated_at();

create table if not exists public.personal_record_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  personal_record_id uuid not null references public.personal_records(id) on delete cascade,
  entry_date date not null,
  weight_kg numeric(8,2) not null default 0,
  reps integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text not null default 'emerald',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger chat_folders_set_updated_at
before update on public.chat_folders
for each row execute function public.set_updated_at();

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('general', 'workout')),
  workout_id uuid references public.workouts(id) on delete cascade,
  folder_id uuid references public.chat_folders(id) on delete set null,
  title text not null,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger chat_sessions_set_updated_at
before update on public.chat_sessions
for each row execute function public.set_updated_at();

alter table public.user_preferences
  add constraint user_preferences_current_general_chat_session_id_fkey
  foreign key (current_general_chat_session_id)
  references public.chat_sessions(id)
  on delete set null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  message_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_profile_heart_rate_zones_user_id on public.profile_heart_rate_zones(user_id);
create index if not exists idx_profile_weekly_schedule_entries_user_day on public.profile_weekly_schedule_entries(user_id, day_of_week);
create index if not exists idx_import_batches_user_created_at on public.import_batches(user_id, created_at desc);
create index if not exists idx_health_daily_user_day on public.health_daily(user_id, day desc);
create index if not exists idx_sleep_timeline_points_daily_occurred_at on public.sleep_timeline_points(health_daily_id, occurred_at);
create index if not exists idx_heart_rate_intraday_points_daily_occurred_at on public.heart_rate_intraday_points(health_daily_id, occurred_at);
create index if not exists idx_steps_hourly_points_daily_hour on public.steps_hourly_points(health_daily_id, hour_of_day);
create index if not exists idx_workouts_user_date on public.workouts(user_id, workout_date desc);
create index if not exists idx_workout_exercises_workout_id on public.workout_exercises(workout_id, exercise_order);
create index if not exists idx_personal_records_user_name on public.personal_records(user_id, exercise_name);
create index if not exists idx_personal_record_entries_record_date on public.personal_record_entries(personal_record_id, entry_date desc);
create index if not exists idx_chat_folders_user_updated_at on public.chat_folders(user_id, updated_at desc);
create index if not exists idx_chat_sessions_user_updated_at on public.chat_sessions(user_id, updated_at desc);
create index if not exists idx_chat_messages_session_order on public.chat_messages(session_id, message_order);

alter table public.profiles enable row level security;
alter table public.profile_heart_rate_zones enable row level security;
alter table public.profile_weekly_schedule_entries enable row level security;
alter table public.coach_memory enable row level security;
alter table public.user_preferences enable row level security;
alter table public.import_batches enable row level security;
alter table public.health_daily enable row level security;
alter table public.sleep_timeline_points enable row level security;
alter table public.heart_rate_intraday_points enable row level security;
alter table public.steps_hourly_points enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.personal_records enable row level security;
alter table public.personal_record_entries enable row level security;
alter table public.chat_folders enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

create policy "profiles own rows" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "profile_heart_rate_zones own rows" on public.profile_heart_rate_zones
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "profile_weekly_schedule_entries own rows" on public.profile_weekly_schedule_entries
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "coach_memory own rows" on public.coach_memory
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_preferences own rows" on public.user_preferences
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "import_batches own rows" on public.import_batches
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "health_daily own rows" on public.health_daily
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "sleep_timeline_points own rows" on public.sleep_timeline_points
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "heart_rate_intraday_points own rows" on public.heart_rate_intraday_points
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "steps_hourly_points own rows" on public.steps_hourly_points
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workouts own rows" on public.workouts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workout_exercises own rows" on public.workout_exercises
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "personal_records own rows" on public.personal_records
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "personal_record_entries own rows" on public.personal_record_entries
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_folders own rows" on public.chat_folders
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_sessions own rows" on public.chat_sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_messages own rows" on public.chat_messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
