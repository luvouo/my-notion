-- Run once in the SQL Editor of the Supabase project used by env.js.
-- Expands weekly_inbox_items.status from Todo/Done to all five widget states.
begin;

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.weekly_inbox_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.weekly_inbox_items drop constraint %I',
      r.conname
    );
  end loop;
end $$;

alter table public.weekly_inbox_items
  add constraint weekly_inbox_items_status_check
  check (
    status in (
      'todo',
      'done',
      'in_progress',
      'hold',
      'carried_over'
    )
  );

commit;
