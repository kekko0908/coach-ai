alter table public.personal_records
  add column if not exists record_type text not null default 'strength'
    check (record_type in ('strength', 'distance', 'duration', 'count', 'calories')),
  add column if not exists unit text not null default 'kg';

alter table public.personal_record_entries
  add column if not exists value_numeric numeric(10,2),
  add column if not exists unit text,
  add column if not exists secondary_value_numeric numeric(10,2),
  add column if not exists secondary_unit text,
  add column if not exists notes text;

update public.personal_records
set
  record_type = coalesce(record_type, 'strength'),
  unit = coalesce(unit, 'kg');

update public.personal_record_entries
set
  value_numeric = coalesce(value_numeric, weight_kg),
  unit = coalesce(unit, 'kg'),
  secondary_value_numeric = coalesce(secondary_value_numeric, reps),
  secondary_unit = coalesce(secondary_unit, 'reps')
where value_numeric is null
   or unit is null
   or secondary_value_numeric is null
   or secondary_unit is null;
