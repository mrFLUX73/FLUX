-- FLUX Workout Editor V2, Slice 2B.
--
-- The global catalog is deliberately separate from public.exercises. The
-- latter remains a private, owner-scoped source table for personal and trainer
-- exercises. This migration is additive: it neither changes live plans nor
-- makes a catalog source selectable by them yet.

create extension if not exists pg_trgm with schema extensions;

-- Normalised fields use lower-cased, trimmed, collapsed-whitespace text. The
-- same expression is applied in the catalog/alias triggers and search API.
-- Transliteration is content, not a database heuristic: an editor adds "RDL"
-- as an alias for the relevant Russian catalog entry.

create table public.muscle_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ru text not null,
  anatomical_group text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint muscle_groups_slug_format check (
    slug = lower(btrim(slug))
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint muscle_groups_name_ru_not_blank check (char_length(btrim(name_ru)) between 1 and 120),
  constraint muscle_groups_anatomical_group_not_blank check (
    anatomical_group is null or char_length(btrim(anatomical_group)) between 1 and 120
  ),
  constraint muscle_groups_sort_order_range check (sort_order between 0 and 10000)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ru text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint equipment_slug_format check (
    slug = lower(btrim(slug))
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint equipment_name_ru_not_blank check (char_length(btrim(name_ru)) between 1 and 120),
  constraint equipment_sort_order_range check (sort_order between 0 and 10000)
);

create table public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  normalized_name text not null,
  measurement_type text not null,
  technique_description text,
  primary_muscle_group_id uuid not null references public.muscle_groups(id) on delete restrict,
  publication_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint exercise_catalog_slug_format check (
    slug = lower(btrim(slug))
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint exercise_catalog_name_not_blank check (char_length(btrim(name)) between 1 and 160),
  constraint exercise_catalog_normalized_name_not_blank check (char_length(btrim(normalized_name)) between 1 and 160),
  constraint exercise_catalog_measurement_type_check check (measurement_type in ('reps', 'duration', 'distance')),
  constraint exercise_catalog_technique_description_length check (
    technique_description is null or char_length(btrim(technique_description)) between 1 and 5000
  ),
  constraint exercise_catalog_publication_status_check check (publication_status in ('draft', 'published', 'archived')),
  -- Media is intentionally not part of this contract. A published exercise
  -- needs a durable name, measurement contract, primary muscle and technique.
  constraint exercise_catalog_published_content_check check (
    publication_status <> 'published'
    or (
      published_at is not null
      and technique_description is not null
      and char_length(btrim(technique_description)) > 0
    )
  )
);

-- Catalog authors do not maintain duplicate normalised values manually. The
-- trigger executes before NOT NULL/CHECK validation and overwrites a supplied
-- derived value, preventing a name/search mismatch.
create or replace function public.normalize_exercise_catalog_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.normalized_name := regexp_replace(lower(btrim(new.name)), E'\\s+', ' ', 'g');
  if new.technique_description is not null then
    new.technique_description := nullif(btrim(new.technique_description), '');
  end if;
  if new.publication_status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger normalize_exercise_catalog_before_write
before insert or update of name, normalized_name, technique_description, publication_status, published_at
on public.exercise_catalog
for each row execute function public.normalize_exercise_catalog_before_write();

create trigger set_exercise_catalog_updated_at
before update on public.exercise_catalog
for each row execute function public.set_updated_at();

create table public.exercise_catalog_muscle_groups (
  catalog_exercise_id uuid not null references public.exercise_catalog(id) on delete cascade,
  muscle_group_id uuid not null references public.muscle_groups(id) on delete restrict,
  role text not null,
  primary key (catalog_exercise_id, muscle_group_id),
  constraint exercise_catalog_muscle_groups_role_check check (role in ('primary', 'secondary'))
);

create table public.exercise_catalog_equipment (
  catalog_exercise_id uuid not null references public.exercise_catalog(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  primary key (catalog_exercise_id, equipment_id)
);

create table public.exercise_catalog_aliases (
  id uuid primary key default gen_random_uuid(),
  catalog_exercise_id uuid not null references public.exercise_catalog(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  constraint exercise_catalog_aliases_alias_not_blank check (char_length(btrim(alias)) between 1 and 160),
  constraint exercise_catalog_aliases_normalized_alias_not_blank check (char_length(btrim(normalized_alias)) between 1 and 160),
  constraint exercise_catalog_aliases_catalog_exercise_normalized_alias_key unique (catalog_exercise_id, normalized_alias)
);

create or replace function public.normalize_exercise_catalog_alias_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.alias := btrim(new.alias);
  new.normalized_alias := regexp_replace(lower(btrim(new.alias)), E'\\s+', ' ', 'g');
  return new;
end;
$$;

create trigger normalize_exercise_catalog_alias_before_write
before insert or update of alias, normalized_alias
on public.exercise_catalog_aliases
for each row execute function public.normalize_exercise_catalog_alias_before_write();

create table public.exercise_catalog_media (
  id uuid primary key default gen_random_uuid(),
  catalog_exercise_id uuid not null references public.exercise_catalog(id) on delete cascade,
  kind text not null,
  url text not null,
  provider text,
  alt_text text,
  poster_url text,
  sort_order integer not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint exercise_catalog_media_kind_check check (kind in ('image', 'video')),
  constraint exercise_catalog_media_url_check check (char_length(btrim(url)) between 1 and 2048 and url ~* '^https?://'),
  constraint exercise_catalog_media_provider_length check (provider is null or char_length(btrim(provider)) between 1 and 120),
  constraint exercise_catalog_media_alt_text_length check (alt_text is null or char_length(btrim(alt_text)) between 1 and 500),
  constraint exercise_catalog_media_poster_url_check check (
    poster_url is null or (char_length(btrim(poster_url)) between 1 and 2048 and poster_url ~* '^https?://')
  ),
  constraint exercise_catalog_media_sort_order_range check (sort_order between 0 and 10000),
  constraint exercise_catalog_media_status_check check (status in ('draft', 'published', 'archived')),
  constraint exercise_catalog_media_sort_order_key unique (catalog_exercise_id, sort_order)
);

-- primary_muscle_group_id is deliberately duplicated for fast common filters.
-- Deferrable constraint triggers allow an author to create the catalog row and
-- its relation rows in one transaction, but reject a committed contradiction.
create or replace function public.enforce_exercise_catalog_primary_muscle_group()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_catalog_exercise_id uuid;
  v_primary_muscle_group_id uuid;
  v_primary_relation_count integer;
begin
  if tg_table_name = 'exercise_catalog' then
    v_catalog_exercise_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_catalog_exercise_id := case when tg_op = 'DELETE' then old.catalog_exercise_id else new.catalog_exercise_id end;
  end if;

  select primary_muscle_group_id
  into v_primary_muscle_group_id
  from public.exercise_catalog
  where id = v_catalog_exercise_id;

  -- A parent deleted by ON DELETE CASCADE has no invariant left to check.
  if v_primary_muscle_group_id is null then
    return null;
  end if;

  select count(*)::integer
  into v_primary_relation_count
  from public.exercise_catalog_muscle_groups
  where catalog_exercise_id = v_catalog_exercise_id
    and role = 'primary';

  if v_primary_relation_count <> 1
     or not exists (
       select 1
       from public.exercise_catalog_muscle_groups relation
       where relation.catalog_exercise_id = v_catalog_exercise_id
         and relation.muscle_group_id = v_primary_muscle_group_id
         and relation.role = 'primary'
     ) then
    raise exception 'Catalog exercise primary muscle group must have exactly one matching primary relation'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger exercise_catalog_primary_muscle_group_on_catalog
after insert or update
on public.exercise_catalog
deferrable initially deferred
for each row execute function public.enforce_exercise_catalog_primary_muscle_group();

create constraint trigger exercise_catalog_primary_muscle_group_on_relation
after insert or update or delete
on public.exercise_catalog_muscle_groups
deferrable initially deferred
for each row execute function public.enforce_exercise_catalog_primary_muscle_group();

-- Published-only search uses trigram indexes for contains matching. This keeps
-- a query such as "rdl" indexable through aliases without loading the catalog
-- into the browser. The compact (name, id) indexes support deterministic empty
-- query and filtered-list pagination.
create index exercise_catalog_published_sort_idx
  on public.exercise_catalog (name, id)
  where publication_status = 'published';
create index exercise_catalog_published_primary_sort_idx
  on public.exercise_catalog (primary_muscle_group_id, name, id)
  where publication_status = 'published';
create index exercise_catalog_normalized_name_trgm_idx
  on public.exercise_catalog using gin (normalized_name extensions.gin_trgm_ops)
  where publication_status = 'published';
create index exercise_catalog_muscle_groups_filter_idx
  on public.exercise_catalog_muscle_groups (muscle_group_id, catalog_exercise_id);
create index exercise_catalog_equipment_filter_idx
  on public.exercise_catalog_equipment (equipment_id, catalog_exercise_id);
create index exercise_catalog_aliases_normalized_alias_trgm_idx
  on public.exercise_catalog_aliases using gin (normalized_alias extensions.gin_trgm_ops);
create index exercise_catalog_media_published_lookup_idx
  on public.exercise_catalog_media (catalog_exercise_id, sort_order)
  where status = 'published';

alter table public.muscle_groups enable row level security;
alter table public.equipment enable row level security;
alter table public.exercise_catalog enable row level security;
alter table public.exercise_catalog_muscle_groups enable row level security;
alter table public.exercise_catalog_equipment enable row level security;
alter table public.exercise_catalog_aliases enable row level security;
alter table public.exercise_catalog_media enable row level security;

create policy muscle_groups_read_authenticated
on public.muscle_groups for select to authenticated
using ((select auth.uid()) is not null);

create policy equipment_read_authenticated
on public.equipment for select to authenticated
using ((select auth.uid()) is not null);

create policy exercise_catalog_read_published
on public.exercise_catalog for select to authenticated
using (
  (select auth.uid()) is not null
  and publication_status = 'published'
);

create policy exercise_catalog_muscle_groups_read_published
on public.exercise_catalog_muscle_groups for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.exercise_catalog catalog
    where catalog.id = catalog_exercise_id
      and catalog.publication_status = 'published'
  )
);

create policy exercise_catalog_equipment_read_published
on public.exercise_catalog_equipment for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.exercise_catalog catalog
    where catalog.id = catalog_exercise_id
      and catalog.publication_status = 'published'
  )
);

create policy exercise_catalog_aliases_read_published
on public.exercise_catalog_aliases for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.exercise_catalog catalog
    where catalog.id = catalog_exercise_id
      and catalog.publication_status = 'published'
  )
);

create policy exercise_catalog_media_read_published
on public.exercise_catalog_media for select to authenticated
using (
  (select auth.uid()) is not null
  and status = 'published'
  and exists (
    select 1 from public.exercise_catalog catalog
    where catalog.id = catalog_exercise_id
      and catalog.publication_status = 'published'
  )
);

-- Explicit grants make Data API exposure intentional. Authenticated users get
-- read-only access subject to RLS; central catalog publishing is service-role
-- only and has no browser-accessible write RPC.
revoke all on table
  public.muscle_groups,
  public.equipment,
  public.exercise_catalog,
  public.exercise_catalog_muscle_groups,
  public.exercise_catalog_equipment,
  public.exercise_catalog_aliases,
  public.exercise_catalog_media
from public, anon, authenticated;

grant select on table
  public.muscle_groups,
  public.equipment,
  public.exercise_catalog,
  public.exercise_catalog_muscle_groups,
  public.exercise_catalog_equipment,
  public.exercise_catalog_aliases,
  public.exercise_catalog_media
to authenticated;

grant select, insert, update, delete on table
  public.muscle_groups,
  public.equipment,
  public.exercise_catalog,
  public.exercise_catalog_muscle_groups,
  public.exercise_catalog_equipment,
  public.exercise_catalog_aliases,
  public.exercise_catalog_media
to service_role;

-- SECURITY INVOKER keeps direct table RLS effective inside the API. The
-- explicit auth.uid() check ensures a role-only caller cannot use it without a
-- request identity. Offset pagination is bounded and deterministic by name/id;
-- it is appropriate for the initial 120–130 row catalog and is simpler than a
-- cursor contract before the picker exists.
create function public.search_exercise_catalog_v1(
  p_query text default null,
  p_muscle_group_slug text default null,
  p_equipment_slug text default null,
  p_measurement_type text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  measurement_type text,
  technique_description text,
  primary_muscle_group_slug text,
  primary_muscle_group_name_ru text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text;
  v_query_pattern text;
  v_muscle_group_slug text;
  v_equipment_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'p_limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'p_offset must be between 0 and 10000' using errcode = '22023';
  end if;
  if p_query is not null and char_length(p_query) > 160 then
    raise exception 'p_query must be at most 160 characters' using errcode = '22023';
  end if;
  if p_measurement_type is not null and p_measurement_type not in ('reps', 'duration', 'distance') then
    raise exception 'Invalid measurement type filter' using errcode = '22023';
  end if;

  -- Keep this expression inline: authenticated callers need execute only on the
  -- search API, never on its internal normalisation helper.
  v_query := nullif(regexp_replace(lower(btrim(coalesce(p_query, ''))), E'\\s+', ' ', 'g'), '');
  v_query_pattern := case when v_query is null then null else
    '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
  end;
  v_muscle_group_slug := nullif(lower(btrim(coalesce(p_muscle_group_slug, ''))), '');
  v_equipment_slug := nullif(lower(btrim(coalesce(p_equipment_slug, ''))), '');

  if v_muscle_group_slug is not null and v_muscle_group_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Invalid muscle group filter' using errcode = '22023';
  end if;
  if v_equipment_slug is not null and v_equipment_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Invalid equipment filter' using errcode = '22023';
  end if;

  return query
  select
    catalog.id,
    catalog.slug,
    catalog.name,
    catalog.measurement_type,
    catalog.technique_description,
    primary_group.slug,
    primary_group.name_ru,
    catalog.created_at,
    catalog.updated_at
  from public.exercise_catalog catalog
  join public.muscle_groups primary_group on primary_group.id = catalog.primary_muscle_group_id
  where catalog.publication_status = 'published'
    and (v_query is null or (
      catalog.normalized_name like v_query_pattern escape E'\\'
      or exists (
        select 1
        from public.exercise_catalog_aliases alias
        where alias.catalog_exercise_id = catalog.id
          and alias.normalized_alias like v_query_pattern escape E'\\'
      )
    ))
    and (p_measurement_type is null or catalog.measurement_type = p_measurement_type)
    and (v_muscle_group_slug is null or exists (
      select 1
      from public.exercise_catalog_muscle_groups relation
      join public.muscle_groups filter_group on filter_group.id = relation.muscle_group_id
      where relation.catalog_exercise_id = catalog.id
        and filter_group.slug = v_muscle_group_slug
    ))
    and (v_equipment_slug is null or exists (
      select 1
      from public.exercise_catalog_equipment relation
      join public.equipment filter_equipment on filter_equipment.id = relation.equipment_id
      where relation.catalog_exercise_id = catalog.id
        and filter_equipment.slug = v_equipment_slug
    ))
  order by catalog.name asc, catalog.id asc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.normalize_exercise_catalog_before_write() from public, anon, authenticated;
revoke all on function public.normalize_exercise_catalog_alias_before_write() from public, anon, authenticated;
revoke all on function public.enforce_exercise_catalog_primary_muscle_group() from public, anon, authenticated;
revoke all on function public.search_exercise_catalog_v1(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_exercise_catalog_v1(text, text, text, text, integer, integer) to authenticated;
