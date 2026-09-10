import { getSupabaseClientForUser } from '../../lib/supabase';

export type TrainerLink = {
  id: string;
  status: 'pending' | 'active' | 'declined' | 'revoked';
  createdAt: string;
  trainerId: string;
  trainerName: string;
  trainerCode: string | null;
  clientId: string;
  clientName: string;
};

type TrainerHubRow = {
  link_id: string;
  status: TrainerLink['status'];
  created_at: string;
  trainer_id: string;
  trainer_name: string;
  trainer_code: string | null;
  client_id: string;
  client_name: string;
};

export async function loadTrainerHub(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_trainer_hub');
  if (error) throw error;
  return ((data ?? []) as TrainerHubRow[]).map((row) => ({
    id: row.link_id,
    status: row.status,
    createdAt: row.created_at,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    trainerCode: row.trainer_code,
    clientId: row.client_id,
    clientName: row.client_name,
  }));
}

export async function loadMyTrainerCode(userId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_trainer_code');
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function setAccountRole(userId: string, role: 'user' | 'trainer') {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('set_my_account_role', { p_role: role });
  if (error) throw error;
  const result = (data as { role: 'user' | 'trainer'; trainer_code: string | null }[] | null)?.[0];
  if (!result) throw new Error('Не удалось изменить роль');
  return { role: result.role, trainerCode: result.trainer_code };
}

export async function requestTrainerConnection(userId: string, code: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('request_trainer_connection', { p_invite_code: code });
  if (error) throw error;
}

export async function respondToTrainerConnection(userId: string, linkId: string, accept: boolean) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('respond_to_trainer_connection', { p_link_id: linkId, p_accept: accept });
  if (error) throw error;
}
