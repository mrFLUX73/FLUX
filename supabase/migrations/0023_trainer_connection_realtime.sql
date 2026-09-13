-- Trainer connections stay private. This trigger sends only an invalidation
-- signal to the two affected existing trainer-user channels; clients reload
-- their authorised hub through get_my_trainer_hub afterwards.
create or replace function public.broadcast_trainer_connection_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('kind', 'trainer_connection_changed'),
    'trainer_connection_changed',
    'trainer-user:' || new.trainer_id::text,
    true
  );
  perform realtime.send(
    jsonb_build_object('kind', 'trainer_connection_changed'),
    'trainer-user:' || new.client_id::text,
    true
  );
  return new;
end;
$$;

drop trigger if exists trainer_client_links_realtime_broadcast on public.trainer_client_links;
create trigger trainer_client_links_realtime_broadcast
after insert or update of status on public.trainer_client_links
for each row execute function public.broadcast_trainer_connection_change();

revoke all on function public.broadcast_trainer_connection_change() from public, anon, authenticated;
