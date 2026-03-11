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

drop policy if exists "profiles own rows" on public.profiles;
drop policy if exists "profile_heart_rate_zones own rows" on public.profile_heart_rate_zones;
drop policy if exists "profile_weekly_schedule_entries own rows" on public.profile_weekly_schedule_entries;
drop policy if exists "coach_memory own rows" on public.coach_memory;
drop policy if exists "user_preferences own rows" on public.user_preferences;
drop policy if exists "import_batches own rows" on public.import_batches;
drop policy if exists "health_daily own rows" on public.health_daily;
drop policy if exists "sleep_timeline_points own rows" on public.sleep_timeline_points;
drop policy if exists "heart_rate_intraday_points own rows" on public.heart_rate_intraday_points;
drop policy if exists "steps_hourly_points own rows" on public.steps_hourly_points;
drop policy if exists "workouts own rows" on public.workouts;
drop policy if exists "workout_exercises own rows" on public.workout_exercises;
drop policy if exists "personal_records own rows" on public.personal_records;
drop policy if exists "personal_record_entries own rows" on public.personal_record_entries;
drop policy if exists "chat_folders own rows" on public.chat_folders;
drop policy if exists "chat_sessions own rows" on public.chat_sessions;
drop policy if exists "chat_messages own rows" on public.chat_messages;

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
