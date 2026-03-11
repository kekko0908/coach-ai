alter table public.coach_memory
  add column if not exists available_equipment text[] not null default '{}';
