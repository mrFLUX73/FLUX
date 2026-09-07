-- Screenshots and photos are private: the author and administrators can read
-- them, while attachment URLs are short-lived signed URLs issued by Supabase.

alter table public.feedback
  add column if not exists attachments text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_attachments_insert_own on storage.objects;
create policy feedback_attachments_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists feedback_attachments_select_own_or_admin on storage.objects;
create policy feedback_attachments_select_own_or_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
  )
);

drop policy if exists feedback_attachments_delete_own on storage.objects;
create policy feedback_attachments_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop function if exists public.create_feedback(text, text, text, text);
create function public.create_feedback(
  p_category text,
  p_message text,
  p_screen text default null,
  p_app_version text default null,
  p_attachments text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_feedback_id uuid;
  attachment_path text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_category not in ('bug', 'idea', 'question', 'praise') then
    raise exception 'Unsupported feedback category' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(p_message, ''))) < 3 then
    raise exception 'Feedback message is too short' using errcode = '23514';
  end if;
  if coalesce(array_length(p_attachments, 1), 0) > 3 then
    raise exception 'Too many attachments' using errcode = '23514';
  end if;
  foreach attachment_path in array coalesce(p_attachments, '{}') loop
    if attachment_path !~ ('^' || current_user_id::text || '/') then
      raise exception 'Attachment path is not owned by current user' using errcode = '42501';
    end if;
  end loop;

  insert into public.feedback (
    user_id, category, message, screen, app_version, reporter_display_name, reporter_login, attachments
  )
  select
    profile.id,
    p_category,
    trim(p_message),
    nullif(trim(coalesce(p_screen, '')), ''),
    nullif(trim(coalesce(p_app_version, '')), ''),
    profile.display_name,
    profile.login,
    coalesce(p_attachments, '{}')
  from public.profiles as profile
  where profile.id = current_user_id
  returning id into new_feedback_id;

  if new_feedback_id is null then
    raise exception 'Profile not found' using errcode = '23503';
  end if;
  return new_feedback_id;
end;
$$;

revoke all on function public.create_feedback(text, text, text, text, text[]) from public, anon;
grant execute on function public.create_feedback(text, text, text, text, text[]) to authenticated;
