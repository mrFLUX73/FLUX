-- Replace the first connection trigger with a fresh function OID. The remote
-- database executed a stale three-argument realtime.send plan, while the
-- current Realtime API requires payload, event, topic and private arguments.
-- Named arguments make that contract explicit.
create function public.broadcast_trainer_connection_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      payload := jsonb_build_object('kind', 'trainer_connection_changed'),
      event := 'trainer_connection_changed',
      topic := 'trainer-user:' || new.trainer_id::text,
      private := true
    );
    perform realtime.send(
      payload := jsonb_build_object('kind', 'trainer_connection_changed'),
      event := 'trainer_connection_changed',
      topic := 'trainer-user:' || new.client_id::text,
      private := true
    );
  exception when others then
    -- Realtime is an invalidation optimisation, never part of the business
    -- transaction. Status changes remain valid even during a Realtime outage.
    raise warning 'Trainer connection invalidation was not broadcast: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trainer_client_links_realtime_broadcast on public.trainer_client_links;
create trigger trainer_client_links_realtime_broadcast
after insert or update of status on public.trainer_client_links
for each row execute function public.broadcast_trainer_connection_invalidation();

revoke all on function public.broadcast_trainer_connection_invalidation() from public, anon, authenticated;
