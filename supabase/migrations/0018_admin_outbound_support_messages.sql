-- Support can start a private conversation when it needs a person to verify a
-- change. The thread uses the existing feedback inbox, so it stays private and
-- the recipient can reply without a separate notification channel.

create or replace function public.start_support_conversation(
  p_recipient text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  target_count integer;
  new_feedback_id uuid;
  normalized_recipient text := lower(trim(regexp_replace(coalesce(p_recipient, ''), '^@', '')));
begin
  if not public.is_admin() then
    raise exception 'Administrator role is required' using errcode = '42501';
  end if;
  if char_length(normalized_recipient) < 2 then
    raise exception 'Recipient is required' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 3 then
    raise exception 'Message is too short' using errcode = '23514';
  end if;

  select count(*) into target_count
  from public.profiles profile
  where lower(coalesce(profile.login, '')) = normalized_recipient
     or lower(coalesce(profile.display_name, '')) = normalized_recipient;

  if target_count = 0 then
    raise exception 'Recipient was not found' using errcode = 'P0002';
  end if;
  if target_count > 1 then
    raise exception 'Several recipients match this name; use @login' using errcode = 'P0003';
  end if;

  select profile.* into target_profile
  from public.profiles profile
  where lower(coalesce(profile.login, '')) = normalized_recipient
     or lower(coalesce(profile.display_name, '')) = normalized_recipient
  limit 1;

  insert into public.feedback (
    user_id, category, message, screen, app_version,
    reporter_display_name, reporter_login, status
  ) values (
    target_profile.id, 'question', 'Сообщение от команды FLUX.', 'Сообщения FLUX', 'FLUX web',
    target_profile.display_name, target_profile.login, 'in_progress'
  ) returning id into new_feedback_id;

  insert into public.feedback_messages (feedback_id, author_id, is_support, body)
  values (new_feedback_id, current_user_id, true, trim(p_body));

  return new_feedback_id;
end;
$$;

revoke all on function public.start_support_conversation(text, text) from public, anon;
grant execute on function public.start_support_conversation(text, text) to authenticated;
