import { getSupabaseClientForUser } from '../../lib/supabase';

export type WorkoutPlanSummary = {
  id: string;
  name: string;
  description: string | null;
  level: string | null;
  estimatedDurationMinutes: number | null;
  exerciseCount: number;
  isActive: boolean;
  updatedAt: string;
};

export type WorkoutPlanStep = {
  stepId: string;
  exerciseId: string;
  name: string;
  instructions: string | null;
  measurementType: 'reps' | 'duration' | 'distance';
  dayNumber: number;
  sortOrder: number;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSeconds: number | null;
  targetDistanceM: number | null;
  targetWeightKg: number | null;
  restSeconds: number;
  notes: string | null;
};

export type WorkoutPlan = WorkoutPlanSummary & { exercises: WorkoutPlanStep[] };

export type PerformedSet = {
  id: string;
  clientSetKey: string | null;
  sessionStepId: string | null;
  exerciseName: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  rpe: number | null;
  isCompleted: boolean;
  completedAt: string;
  notes: string | null;
};

export type WorkoutSession = {
  id: string;
  planId: string | null;
  sourceType: 'personal_plan' | 'trainer_assignment';
  title: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  overallRpe: number | null;
  notes: string | null;
  planSnapshot: WorkoutPlanStep[];
  sets: PerformedSet[];
};

export type WorkoutHistoryItem = Pick<WorkoutSession, 'id' | 'title' | 'sourceType' | 'startedAt' | 'completedAt' | 'overallRpe'> & { completedSets: number };

const number = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0);
const nullableNumber = (value: unknown) => value == null ? null : number(value);
const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};

function toStep(raw: unknown): WorkoutPlanStep {
  const value = record(raw);
  const measurement = String(value.measurement_type ?? 'reps');
  return {
    stepId: String(value.step_id), exerciseId: String(value.exercise_id), name: String(value.name ?? 'Упражнение'),
    instructions: value.instructions == null ? null : String(value.instructions),
    measurementType: measurement === 'duration' || measurement === 'distance' ? measurement : 'reps',
    dayNumber: number(value.day_number), sortOrder: number(value.sort_order), targetSets: number(value.target_sets),
    targetRepsMin: nullableNumber(value.target_reps_min), targetRepsMax: nullableNumber(value.target_reps_max),
    targetDurationSeconds: nullableNumber(value.target_duration_seconds), targetDistanceM: nullableNumber(value.target_distance_m),
    targetWeightKg: nullableNumber(value.target_weight_kg), restSeconds: number(value.rest_seconds),
    notes: value.notes == null ? null : String(value.notes),
  };
}

function toPerformedSet(raw: unknown): PerformedSet {
  const value = record(raw);
  return {
    id: String(value.id), clientSetKey: value.client_set_key == null ? null : String(value.client_set_key),
    sessionStepId: value.session_step_id == null ? null : String(value.session_step_id), exerciseName: String(value.exercise_name ?? 'Упражнение'),
    setNumber: number(value.set_number), reps: nullableNumber(value.reps), weightKg: nullableNumber(value.weight_kg),
    durationSeconds: nullableNumber(value.duration_seconds), distanceM: nullableNumber(value.distance_m), rpe: nullableNumber(value.rpe),
    isCompleted: Boolean(value.is_completed), completedAt: String(value.completed_at), notes: value.notes == null ? null : String(value.notes),
  };
}

function toSession(raw: unknown): WorkoutSession {
  const value = record(raw);
  const status = String(value.status ?? 'in_progress');
  const source = String(value.source_type ?? 'personal_plan');
  return {
    id: String(value.id), planId: value.plan_id == null ? null : String(value.plan_id),
    sourceType: source === 'trainer_assignment' ? source : 'personal_plan',
    title: String(value.title ?? 'Тренировка'),
    status: status === 'completed' || status === 'cancelled' || status === 'planned' ? status : 'in_progress',
    startedAt: String(value.started_at), completedAt: value.completed_at == null ? null : String(value.completed_at),
    overallRpe: nullableNumber(value.overall_rpe), notes: value.notes == null ? null : String(value.notes),
    planSnapshot: Array.isArray(value.plan_snapshot) ? value.plan_snapshot.map(toStep) : [],
    sets: Array.isArray(value.sets) ? value.sets.map(toPerformedSet) : [],
  };
}

export async function loadWorkoutPlans(userId: string): Promise<WorkoutPlanSummary[]> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_plans');
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((raw) => {
    const value = record(raw);
    return {
      id: String(value.id), name: String(value.name ?? 'План'), description: value.description == null ? null : String(value.description),
      level: value.level == null ? null : String(value.level), estimatedDurationMinutes: nullableNumber(value.estimated_duration_minutes),
      exerciseCount: number(value.exercise_count), isActive: Boolean(value.is_active), updatedAt: String(value.updated_at),
    };
  });
}

export async function loadWorkoutPlan(userId: string, planId: string): Promise<WorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_plan', { p_plan_id: planId });
  if (error) throw error;
  const value = record(data);
  return {
    id: String(value.id), name: String(value.name ?? 'План'), description: value.description == null ? null : String(value.description),
    level: value.level == null ? null : String(value.level), estimatedDurationMinutes: nullableNumber(value.estimated_duration_minutes),
    exerciseCount: Array.isArray(value.exercises) ? value.exercises.length : 0, isActive: Boolean(value.is_active), updatedAt: '',
    exercises: Array.isArray(value.exercises) ? value.exercises.map(toStep) : [],
  };
}

export async function startPersonalWorkout(userId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('start_personal_workout', { p_plan_id: planId });
  if (error) throw error;
  return toSession(data);
}

export async function loadActiveWorkoutSession(userId: string): Promise<WorkoutSession | null> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_active_workout_session');
  if (error) throw error;
  return data == null ? null : toSession(data);
}

export async function loadWorkoutSession(userId: string, sessionId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_session', { p_session_id: sessionId });
  if (error) throw error;
  return toSession(data);
}

export type SavePerformedSetInput = {
  sessionId: string;
  clientSetKey: string;
  stepId: string;
  setNumber: number;
  reps?: number | null;
  weightKg?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  notes?: string | null;
};

export async function savePerformedSet(userId: string, input: SavePerformedSetInput) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_my_performed_set', {
    p_session_id: input.sessionId, p_client_set_key: input.clientSetKey, p_session_step_id: input.stepId,
    p_set_number: input.setNumber, p_reps: input.reps ?? null, p_weight_kg: input.weightKg ?? null,
    p_duration_seconds: input.durationSeconds ?? null, p_distance_m: input.distanceM ?? null,
    p_rpe: input.rpe ?? null, p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return toPerformedSet(data);
}

export async function completeWorkoutSession(userId: string, sessionId: string, overallRpe: number | null) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('complete_my_workout_session', { p_session_id: sessionId, p_overall_rpe: overallRpe, p_notes: null });
  if (error) throw error;
  return toSession(data);
}

export async function loadWorkoutHistory(userId: string): Promise<WorkoutHistoryItem[]> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_history', { p_limit: 24 });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((raw) => {
    const value = record(raw); const source = String(value.source_type ?? 'personal_plan');
    return {
      id: String(value.id), title: String(value.title ?? 'Тренировка'), sourceType: source === 'trainer_assignment' ? source : 'personal_plan',
      startedAt: String(value.started_at), completedAt: value.completed_at == null ? null : String(value.completed_at),
      overallRpe: nullableNumber(value.overall_rpe), completedSets: number(value.completed_sets),
    };
  });
}
