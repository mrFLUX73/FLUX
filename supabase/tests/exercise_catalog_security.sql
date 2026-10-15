-- Exercise catalog Slice 2B security contract.
-- Run only against an isolated local Supabase database after migration
-- 20261010211915_exercise_catalog_security_foundation.sql. The transaction is
-- rolled back, so no fixtures survive. It intentionally does not connect to a
-- linked or production project.

begin;

insert into public.muscle_groups (id, slug, name_ru)
values
  ('10000000-0000-0000-0000-000000000001', 'hamstrings', 'Задняя поверхность бедра'),
  ('10000000-0000-0000-0000-000000000002', 'chest', 'Грудь');

insert into public.equipment (id, slug, name_ru)
values ('20000000-0000-0000-0000-000000000001', 'barbell', 'Штанга');

insert into public.exercise_catalog (id, slug, name, measurement_type, technique_description, primary_muscle_group_id, publication_status)
values
  ('30000000-0000-0000-0000-000000000001', 'romanian-deadlift', 'Румынская тяга', 'reps', 'Контролируйте нейтральное положение спины.', '10000000-0000-0000-0000-000000000001', 'published'),
  ('30000000-0000-0000-0000-000000000002', 'bench-press', 'Жим лёжа', 'reps', 'Опускайте штангу под контролем.', '10000000-0000-0000-0000-000000000002', 'published'),
  ('30000000-0000-0000-0000-000000000003', 'draft-lunge', 'Черновой выпад', 'reps', 'Черновое описание.', '10000000-0000-0000-0000-000000000001', 'draft'),
  ('30000000-0000-0000-0000-000000000004', 'archived-lunge', 'Архивный выпад', 'reps', 'Архивное описание.', '10000000-0000-0000-0000-000000000001', 'archived');

insert into public.exercise_catalog_muscle_groups (catalog_exercise_id, muscle_group_id, role)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'primary'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'primary'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'primary'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'primary');

insert into public.exercise_catalog_equipment (catalog_exercise_id, equipment_id)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

insert into public.exercise_catalog_aliases (catalog_exercise_id, alias)
values
  ('30000000-0000-0000-0000-000000000001', 'RDL'),
  ('30000000-0000-0000-0000-000000000003', 'hidden-draft-alias');

insert into public.exercise_catalog_media (catalog_exercise_id, kind, url, status, sort_order)
values
  ('30000000-0000-0000-0000-000000000001', 'image', 'https://example.test/rdl-published.jpg', 'published', 0),
  ('30000000-0000-0000-0000-000000000001', 'image', 'https://example.test/rdl-draft.jpg', 'draft', 1),
  ('30000000-0000-0000-0000-000000000003', 'image', 'https://example.test/draft-catalog.jpg', 'published', 0);

set constraints all immediate;

-- The Slice must not alter the legacy owner-only policy on private exercises.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'exercises'
      and policyname = 'exercises_manage_own'
  ) then
    raise exception 'Legacy private exercises policy is missing';
  end if;
end;
$$;

-- A normal authenticated user sees only published catalog graph rows and can
-- search via a Latin alias. No client write privilege is present.
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
begin
  if (select count(*) from public.exercise_catalog) <> 2 then
    raise exception 'Authenticated catalog visibility leaked hidden rows';
  end if;
  if exists (select 1 from public.exercise_catalog_aliases where alias = 'hidden-draft-alias') then
    raise exception 'Authenticated alias visibility leaked a hidden catalog row';
  end if;
  if (select count(*) from public.exercise_catalog_muscle_groups) <> 2
     or (select count(*) from public.exercise_catalog_equipment) <> 1 then
    raise exception 'Authenticated relation visibility leaked hidden catalog rows';
  end if;
  if (select count(*) from public.exercise_catalog_media) <> 1 then
    raise exception 'Authenticated media visibility leaked unpublished media';
  end if;
  if (select count(*) from public.search_exercise_catalog_v1('RDL', null, 'barbell', 'reps', 10, 0)) <> 1 then
    raise exception 'Alias search or equipment filter failed';
  end if;
  if (select count(*) from public.search_exercise_catalog_v1('', null, null, null, 1, 0)) <> 1
     or (select count(*) from public.search_exercise_catalog_v1('', null, null, null, 1, 1)) <> 1 then
    raise exception 'Stable empty-query pagination failed';
  end if;
  if exists (select 1 from public.search_exercise_catalog_v1('%'' or 1=1 --', null, null, null, 10, 0)) then
    raise exception 'Search injection input changed query semantics';
  end if;
  begin
    perform public.search_exercise_catalog_v1(null, null, null, 'invalid', 10, 0);
    raise exception 'Invalid measurement filter did not fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.search_exercise_catalog_v1(null, 'not a slug', null, null, 10, 0);
    raise exception 'Invalid muscle group filter did not fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.search_exercise_catalog_v1(null, null, null, null, 51, 0);
    raise exception 'Excessive page size did not fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into public.exercise_catalog (slug, name, measurement_type, technique_description, primary_muscle_group_id)
    values ('forbidden-client-write', 'Запрещено', 'reps', 'Не должно вставиться.', '10000000-0000-0000-0000-000000000001');
    raise exception 'Authenticated catalog write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.muscle_groups (slug, name_ru) values ('forbidden-client-group', 'Запрещено');
    raise exception 'Authenticated reference write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.exercise_catalog_media (catalog_exercise_id, kind, url, status, sort_order)
    values ('30000000-0000-0000-0000-000000000001', 'image', 'https://example.test/forbidden.jpg', 'published', 99);
    raise exception 'Authenticated media write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role anon;

do $$
begin
  begin
    perform 1 from public.exercise_catalog;
    raise exception 'Anon catalog read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.search_exercise_catalog_v1(null, null, null, null, 10, 0);
    raise exception 'Anon search execution unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
