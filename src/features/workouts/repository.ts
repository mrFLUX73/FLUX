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
  origin: 'personal' | 'trainer_assigned';
  trainerId: string | null;
  trainerName: string | null;
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

export type TrainerAssignedPlanSummary = WorkoutPlanSummary;

export type PersonalExercise = {
  id: string;
  name: string;
  measurementType: 'reps' | 'duration' | 'distance';
  instructions: string | null;
  category: string | null;
  equipment?: string[];
  primaryMuscles?: string[];
};

export type ExerciseCatalogItem = {
  id: string;
  slug: string;
  name: string;
  measurementType: PersonalExercise['measurementType'];
  techniqueDescription: string | null;
  primaryMuscleGroupSlug: string;
  primaryMuscleGroupName: string;
  equipment: string[];
};

export type ExerciseCatalogFilterOption = {
  slug: string;
  name: string;
};

export type WorkoutPlanDraftStep = {
  exerciseId: string;
  targetSets: number;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetDurationSeconds?: number | null;
  targetDistanceM?: number | null;
  targetWeightKg?: number | null;
  restSeconds: number;
  notes?: string | null;
};

export type WorkoutPlanDraft = {
  id?: string | null;
  name: string;
  description?: string | null;
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
  estimatedDurationMinutes?: number | null;
  steps: WorkoutPlanDraftStep[];
};

export type WorkoutExerciseSourceKind = 'catalog' | 'personal' | 'trainer_private';

export type WorkoutExerciseSnapshot = {
  sourceKind: WorkoutExerciseSourceKind;
  sourceId: string;
  name: string;
  instructions: string | null;
  measurementType: WorkoutPlanStep['measurementType'];
};

export type SourceAwareWorkoutPlanStep = Omit<WorkoutPlanStep, 'exerciseId'> & {
  exerciseId: string | null;
  exerciseSourceKind: WorkoutExerciseSourceKind | null;
  exerciseSourceId: string | null;
  exerciseSnapshot: WorkoutExerciseSnapshot | null;
};

export type SourceAwareWorkoutPlan = Omit<WorkoutPlan, 'exercises'> & {
  exercises: SourceAwareWorkoutPlanStep[];
};

export type SourceAwareWorkoutPlanDraftStep = Omit<WorkoutPlanDraftStep, 'exerciseId'> & {
  stepId?: string | null;
  exerciseSourceKind?: WorkoutExerciseSourceKind | null;
  exerciseSourceId?: string | null;
  dayNumber?: number | null;
};

export type SourceAwareWorkoutPlanDraft = Omit<WorkoutPlanDraft, 'steps'> & {
  steps: SourceAwareWorkoutPlanDraftStep[];
};

// V3 keeps planned targets separate from execution history. `setId` is absent
// only for the virtual legacy fallback returned before the first V3 save.
export type WorkoutPlanSetTarget = {
  setId: string | null;
  setNumber: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSeconds: number | null;
  targetDistanceM: number | null;
  targetWeightKg: number | null;
  restSeconds: number | null;
};

export type WorkoutPlanSetTargetDraft = Omit<WorkoutPlanSetTarget, 'setId' | 'setNumber'> & {
  setId?: string | null;
};

export type SourceAwareWorkoutPlanStepV3 = SourceAwareWorkoutPlanStep & {
  plannedSets: WorkoutPlanSetTarget[];
};

export type SourceAwareWorkoutPlanV3 = Omit<SourceAwareWorkoutPlan, 'exercises'> & {
  exercises: SourceAwareWorkoutPlanStepV3[];
};

export type SourceAwareWorkoutPlanDraftStepV3 = Omit<SourceAwareWorkoutPlanDraftStep, 'targetSets' | 'targetRepsMin' | 'targetRepsMax' | 'targetDurationSeconds' | 'targetDistanceM' | 'targetWeightKg' | 'restSeconds'> & {
  plannedSets: WorkoutPlanSetTargetDraft[];
};

export type SourceAwareWorkoutPlanDraftV3 = Omit<SourceAwareWorkoutPlanDraft, 'steps'> & {
  steps: SourceAwareWorkoutPlanDraftStepV3[];
};

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

export type SourceAwareWorkoutSession = Omit<WorkoutSession, 'planSnapshot'> & {
  planSnapshot: SourceAwareWorkoutPlanStep[];
};

export type SourceAwareWorkoutSessionV3 = Omit<SourceAwareWorkoutSession, 'planSnapshot'> & {
  planSnapshot: SourceAwareWorkoutPlanStepV3[];
};

export type WorkoutExecutionCheckpoint = {
  workoutSessionId: string;
  sessionStepId: string;
  setNumber: number;
  phase: 'ready' | 'active' | 'paused' | 'rest' | 'next';
  durationAccumulatedSeconds: number;
  durationStartedAt: string | null;
  durationIsManual: boolean;
  restEndsAt: string | null;
  restTotalSeconds: number | null;
  draftReps: number | null;
  draftWeightKg: number | null;
  draftDurationSeconds: number | null;
  draftDistanceM: number | null;
  draftRpe: number | null;
  draftNotes: string | null;
  clientSetKey: string;
  revision: number;
  updatedAt: string;
};

export type SaveWorkoutExecutionCheckpointInput = Omit<WorkoutExecutionCheckpoint, 'workoutSessionId' | 'revision' | 'updatedAt'> & {
  workoutSessionId: string;
  revision: number | null;
};

export type WorkoutHistoryItem = Pick<WorkoutSession, 'id' | 'title' | 'sourceType' | 'startedAt' | 'completedAt' | 'overallRpe'> & { completedSets: number };

const number = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0);
const nullableNumber = (value: unknown) => value == null ? null : number(value);
const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};

function toStep(raw: unknown): WorkoutPlanStep {
  const value = record(raw);
  const measurement = String(value.measurement_type ?? 'reps');
  return {
    stepId: String(value.step_id), exerciseId: value.exercise_id == null ? '' : String(value.exercise_id), name: String(value.name ?? 'Упражнение'),
    instructions: value.instructions == null ? null : String(value.instructions),
    measurementType: measurement === 'duration' || measurement === 'distance' ? measurement : 'reps',
    dayNumber: number(value.day_number), sortOrder: number(value.sort_order), targetSets: number(value.target_sets),
    targetRepsMin: nullableNumber(value.target_reps_min), targetRepsMax: nullableNumber(value.target_reps_max),
    targetDurationSeconds: nullableNumber(value.target_duration_seconds), targetDistanceM: nullableNumber(value.target_distance_m),
    targetWeightKg: nullableNumber(value.target_weight_kg), restSeconds: number(value.rest_seconds),
    notes: value.notes == null ? null : String(value.notes),
  };
}

function toSourceKind(value: unknown): WorkoutExerciseSourceKind | null {
  const source = String(value ?? '');
  return source === 'catalog' || source === 'personal' || source === 'trainer_private' ? source : null;
}

function toSourceAwareStep(raw: unknown): SourceAwareWorkoutPlanStep {
  const value = record(raw);
  const base = toStep(raw);
  const snapshot = record(value.exercise_snapshot);
  const snapshotSourceKind = toSourceKind(snapshot.source_kind);
  const sourceKind = toSourceKind(value.exercise_source_kind);
  const snapshotMeasurement = String(snapshot.measurement_type ?? base.measurementType);
  return {
    ...base,
    exerciseId: value.exercise_id == null ? null : String(value.exercise_id),
    exerciseSourceKind: sourceKind,
    exerciseSourceId: value.exercise_source_id == null ? null : String(value.exercise_source_id),
    exerciseSnapshot: snapshotSourceKind && snapshot.source_id != null ? {
      sourceKind: snapshotSourceKind,
      sourceId: String(snapshot.source_id),
      name: String(snapshot.name ?? base.name),
      instructions: snapshot.instructions == null ? null : String(snapshot.instructions),
      measurementType: snapshotMeasurement === 'duration' || snapshotMeasurement === 'distance' ? snapshotMeasurement : 'reps',
    } : null,
  };
}

function toPlannedSet(raw: unknown): WorkoutPlanSetTarget {
  const value = record(raw);
  return {
    setId: value.set_id == null ? null : String(value.set_id), setNumber: number(value.set_number),
    targetRepsMin: nullableNumber(value.target_reps_min), targetRepsMax: nullableNumber(value.target_reps_max),
    targetDurationSeconds: nullableNumber(value.target_duration_seconds), targetDistanceM: nullableNumber(value.target_distance_m),
    targetWeightKg: nullableNumber(value.target_weight_kg), restSeconds: nullableNumber(value.rest_seconds),
  };
}

function toSourceAwareStepV3(raw: unknown): SourceAwareWorkoutPlanStepV3 {
  const value = record(raw);
  return {
    ...toSourceAwareStep(raw),
    plannedSets: Array.isArray(value.planned_sets) ? value.planned_sets.map(toPlannedSet) : [],
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

function toWorkoutExecutionCheckpoint(raw: unknown): WorkoutExecutionCheckpoint {
  const value = record(raw);
  const phase = String(value.phase ?? 'ready');
  return {
    workoutSessionId: String(value.workout_session_id), sessionStepId: String(value.session_step_id), setNumber: number(value.set_number),
    phase: phase === 'active' || phase === 'paused' || phase === 'rest' || phase === 'next' ? phase : 'ready',
    durationAccumulatedSeconds: number(value.duration_accumulated_seconds), durationStartedAt: value.duration_started_at == null ? null : String(value.duration_started_at),
    durationIsManual: Boolean(value.duration_is_manual), restEndsAt: value.rest_ends_at == null ? null : String(value.rest_ends_at), restTotalSeconds: nullableNumber(value.rest_total_seconds),
    draftReps: nullableNumber(value.draft_reps), draftWeightKg: nullableNumber(value.draft_weight_kg),
    draftDurationSeconds: nullableNumber(value.draft_duration_seconds), draftDistanceM: nullableNumber(value.draft_distance_m),
    draftRpe: nullableNumber(value.draft_rpe), draftNotes: value.draft_notes == null ? null : String(value.draft_notes),
    clientSetKey: String(value.client_set_key), revision: number(value.revision), updatedAt: String(value.updated_at),
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

function toSourceAwareSession(raw: unknown): SourceAwareWorkoutSession {
  const value = record(raw);
  const session = toSession(raw);
  return { ...session, planSnapshot: Array.isArray(value.plan_snapshot) ? value.plan_snapshot.map(toSourceAwareStep) : [] };
}

function toSourceAwareSessionV3(raw: unknown): SourceAwareWorkoutSessionV3 {
  const value = record(raw);
  const session = toSession(raw);
  return { ...session, planSnapshot: Array.isArray(value.plan_snapshot) ? value.plan_snapshot.map(toSourceAwareStepV3) : [] };
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
      origin: value.plan_origin === 'trainer_assigned' ? 'trainer_assigned' : 'personal',
      trainerId: value.assigned_by_trainer_id == null ? null : String(value.assigned_by_trainer_id),
      trainerName: value.trainer_name == null ? null : String(value.trainer_name),
    };
  });
}

function toPersonalExercise(raw: unknown): PersonalExercise {
  const value = record(raw); const type = String(value.measurement_type ?? 'reps');
  const strings = (input: unknown) => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
  return {
    id: String(value.id), name: String(value.name ?? 'Упражнение'),
    measurementType: type === 'duration' || type === 'distance' ? type : 'reps',
    instructions: value.instructions == null ? null : String(value.instructions),
    category: value.category == null ? null : String(value.category),
    equipment: strings(value.equipment), primaryMuscles: strings(value.primary_muscles),
  };
}

export async function loadMyExercises(userId: string): Promise<PersonalExercise[]> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_exercises');
  if (error) throw error;
  return ((data ?? []) as unknown[]).map(toPersonalExercise);
}

export async function loadExerciseCatalogFilters(userId: string): Promise<{ muscleGroups: ExerciseCatalogFilterOption[]; equipment: ExerciseCatalogFilterOption[] }> {
  const client = await getSupabaseClientForUser(userId);
  const [musclesResult, equipmentResult] = await Promise.all([
    client.from('muscle_groups').select('slug,name_ru').order('sort_order').order('name_ru'),
    client.from('equipment').select('slug,name_ru').order('sort_order').order('name_ru'),
  ]);
  if (musclesResult.error) throw musclesResult.error;
  if (equipmentResult.error) throw equipmentResult.error;
  const toOption = (raw: unknown): ExerciseCatalogFilterOption => {
    const value = record(raw);
    return { slug: String(value.slug ?? ''), name: String(value.name_ru ?? '') };
  };
  return {
    muscleGroups: (musclesResult.data ?? []).map(toOption).filter((item) => item.slug && item.name),
    equipment: (equipmentResult.data ?? []).map(toOption).filter((item) => item.slug && item.name),
  };
}

export async function searchExerciseCatalog(userId: string, input: {
  query?: string;
  muscleGroupSlug?: string | null;
  equipmentSlug?: string | null;
  offset?: number;
  limit?: number;
}): Promise<ExerciseCatalogItem[]> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('search_exercise_catalog_v1', {
    p_query: input.query?.trim() || null,
    p_muscle_group_slug: input.muscleGroupSlug || null,
    p_equipment_slug: input.equipmentSlug || null,
    p_measurement_type: null,
    p_limit: input.limit ?? 20,
    p_offset: input.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const ids = rows.map((raw) => String(record(raw).id ?? '')).filter(Boolean);
  const equipmentByExercise = new Map<string, string[]>();
  if (ids.length) {
    const { data: equipmentRows, error: equipmentError } = await client
      .from('exercise_catalog_equipment')
      .select('catalog_exercise_id,equipment(name_ru)')
      .in('catalog_exercise_id', ids);
    if (equipmentError) throw equipmentError;
    for (const raw of equipmentRows ?? []) {
      const value = record(raw);
      const exerciseId = String(value.catalog_exercise_id ?? '');
      const nested = value.equipment;
      const equipmentValue = Array.isArray(nested) ? record(nested[0]) : record(nested);
      const name = String(equipmentValue.name_ru ?? '');
      if (!exerciseId || !name) continue;
      equipmentByExercise.set(exerciseId, [...(equipmentByExercise.get(exerciseId) ?? []), name]);
    }
  }
  return rows.map((raw): ExerciseCatalogItem => {
    const value = record(raw);
    const measurement = String(value.measurement_type ?? 'reps');
    const id = String(value.id ?? '');
    return {
      id,
      slug: String(value.slug ?? ''),
      name: String(value.name ?? 'Упражнение'),
      measurementType: measurement === 'duration' || measurement === 'distance' ? measurement : 'reps',
      techniqueDescription: value.technique_description == null ? null : String(value.technique_description),
      primaryMuscleGroupSlug: String(value.primary_muscle_group_slug ?? ''),
      primaryMuscleGroupName: String(value.primary_muscle_group_name_ru ?? ''),
      equipment: equipmentByExercise.get(id) ?? [],
    };
  });
}

export async function createMyExercise(userId: string, input: {
  name: string;
  measurementType: PersonalExercise['measurementType'];
  instructions?: string | null;
  category?: string | null;
  equipment?: string[];
  primaryMuscles?: string[];
}) {
  const client = await getSupabaseClientForUser(userId);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error('Exercise name is required');
  if (!['reps', 'duration', 'distance'].includes(input.measurementType)) throw new Error('Invalid measurement type');
  const instructions = input.instructions?.trim() || null;
  if (instructions && instructions.length > 5000) throw new Error('Exercise instructions are too long');
  const cleanList = (value: string[] | undefined) => [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
  const { data, error } = await client
    .from('exercises')
    .insert({
      user_id: userId,
      name,
      measurement_type: input.measurementType,
      instructions,
      category: input.category?.trim() || null,
      equipment: cleanList(input.equipment),
      primary_muscles: cleanList(input.primaryMuscles),
    })
    .select('id,name,measurement_type,instructions,category,equipment,primary_muscles')
    .single();
  if (error) throw error;
  return toPersonalExercise(data);
}

export async function updateMyExercise(userId: string, exerciseId: string, input: { name: string; instructions?: string | null; category?: string | null }) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('update_my_exercise', { p_exercise_id: exerciseId, p_name: input.name, p_instructions: input.instructions ?? null, p_category: input.category ?? null });
  if (error) throw error;
  return toPersonalExercise(data);
}

export async function deleteMyExercise(userId: string, exerciseId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('delete_my_exercise', { p_exercise_id: exerciseId });
  if (error) throw error;
}

export async function saveMyWorkoutPlan(userId: string, draft: WorkoutPlanDraft): Promise<WorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_my_workout_plan', {
    p_plan_id: draft.id ?? null, p_name: draft.name, p_description: draft.description ?? null,
    p_level: draft.level ?? null, p_estimated_duration_minutes: draft.estimatedDurationMinutes ?? null,
    p_steps: draft.steps.map((step) => ({ exercise_id: step.exerciseId, target_sets: step.targetSets, target_reps_min: step.targetRepsMin ?? null, target_reps_max: step.targetRepsMax ?? null, target_duration_seconds: step.targetDurationSeconds ?? null, target_distance_m: step.targetDistanceM ?? null, target_weight_kg: step.targetWeightKg ?? null, rest_seconds: step.restSeconds, notes: step.notes ?? null })),
  });
  if (error) throw error;
  return toPlan(data);
}

const toV2RpcSteps = (steps: SourceAwareWorkoutPlanDraftStep[]) => steps.map((step) => ({
  step_id: step.stepId ?? null,
  exercise_source_kind: step.exerciseSourceKind ?? null,
  exercise_source_id: step.exerciseSourceId ?? null,
  day_number: step.dayNumber ?? 1,
  target_sets: step.targetSets,
  target_reps_min: step.targetRepsMin ?? null,
  target_reps_max: step.targetRepsMax ?? null,
  target_duration_seconds: step.targetDurationSeconds ?? null,
  target_distance_m: step.targetDistanceM ?? null,
  target_weight_kg: step.targetWeightKg ?? null,
  rest_seconds: step.restSeconds,
  notes: step.notes ?? null,
}));

const toV3RpcSteps = (steps: SourceAwareWorkoutPlanDraftStepV3[]) => steps.map((step) => ({
  step_id: step.stepId ?? null,
  exercise_source_kind: step.exerciseSourceKind ?? null,
  exercise_source_id: step.exerciseSourceId ?? null,
  day_number: step.dayNumber ?? 1,
  notes: step.notes ?? null,
  planned_sets: step.plannedSets.map((target) => ({
    set_id: target.setId ?? null,
    target_reps_min: target.targetRepsMin ?? null,
    target_reps_max: target.targetRepsMax ?? null,
    target_duration_seconds: target.targetDurationSeconds ?? null,
    target_distance_m: target.targetDistanceM ?? null,
    target_weight_kg: target.targetWeightKg ?? null,
    rest_seconds: target.restSeconds ?? null,
  })),
}));

export async function saveMyWorkoutPlanV2(userId: string, draft: SourceAwareWorkoutPlanDraft): Promise<SourceAwareWorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_my_workout_plan_v2', {
    p_plan_id: draft.id ?? null, p_name: draft.name, p_description: draft.description ?? null,
    p_level: draft.level ?? null, p_estimated_duration_minutes: draft.estimatedDurationMinutes ?? null,
    p_steps: toV2RpcSteps(draft.steps),
  });
  if (error) throw error;
  return toSourceAwarePlan(data);
}

export async function saveMyWorkoutPlanV3(userId: string, draft: SourceAwareWorkoutPlanDraftV3): Promise<SourceAwareWorkoutPlanV3> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_my_workout_plan_v3', {
    p_plan_id: draft.id ?? null, p_name: draft.name, p_description: draft.description ?? null,
    p_level: draft.level ?? null, p_estimated_duration_minutes: draft.estimatedDurationMinutes ?? null,
    p_steps: toV3RpcSteps(draft.steps),
  });
  if (error) throw error;
  return toSourceAwarePlanV3(data);
}

export async function duplicateMyWorkoutPlan(userId: string, planId: string): Promise<WorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('duplicate_my_workout_plan', { p_plan_id: planId });
  if (error) throw error;
  return toPlan(data);
}

export async function archiveMyWorkoutPlan(userId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('archive_my_workout_plan', { p_plan_id: planId });
  if (error) throw error;
}

export async function deleteMyWorkoutPlan(userId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('delete_my_workout_plan_v3', { p_plan_id: planId });
  if (error) throw error;
}

export async function loadWorkoutPlan(userId: string, planId: string): Promise<WorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_plan', { p_plan_id: planId });
  if (error) throw error;
  return toPlan(data);
}

export async function loadWorkoutPlanV2(userId: string, planId: string): Promise<SourceAwareWorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_plan_v2', { p_plan_id: planId });
  if (error) throw error;
  return toSourceAwarePlan(data);
}

export async function loadWorkoutPlanV3(userId: string, planId: string): Promise<SourceAwareWorkoutPlanV3> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_plan_v3', { p_plan_id: planId });
  if (error) throw error;
  return toSourceAwarePlanV3(data);
}

export async function loadTrainerAssignedWorkoutPlans(userId: string, linkId: string): Promise<TrainerAssignedPlanSummary[]> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_assigned_workout_plans', { p_link_id: linkId });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((raw) => {
    const value = record(raw);
    return {
      id: String(value.id), name: String(value.name ?? 'План'), description: value.description == null ? null : String(value.description),
      level: value.level == null ? null : String(value.level), estimatedDurationMinutes: nullableNumber(value.estimated_duration_minutes),
      exerciseCount: number(value.exercise_count), isActive: Boolean(value.is_active), updatedAt: String(value.updated_at),
      origin: 'trainer_assigned' as const, trainerId: null, trainerName: null,
    };
  });
}

export async function loadTrainerAssignedWorkoutPlan(userId: string, linkId: string, planId: string): Promise<WorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_assigned_workout_plan', { p_link_id: linkId, p_plan_id: planId });
  if (error) throw error;
  return toPlan(data);
}

export async function loadTrainerAssignedWorkoutPlanV2(userId: string, linkId: string, planId: string): Promise<SourceAwareWorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_assigned_workout_plan_v2', { p_link_id: linkId, p_plan_id: planId });
  if (error) throw error;
  return toSourceAwarePlan(data);
}

export async function loadTrainerAssignedWorkoutPlanV3(userId: string, linkId: string, planId: string): Promise<SourceAwareWorkoutPlanV3> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_trainer_assigned_workout_plan_v3', { p_link_id: linkId, p_plan_id: planId });
  if (error) throw error;
  return toSourceAwarePlanV3(data);
}

const toRpcSteps = (steps: WorkoutPlanDraftStep[]) => steps.map((step) => ({
  exercise_id: step.exerciseId, target_sets: step.targetSets, target_reps_min: step.targetRepsMin ?? null,
  target_reps_max: step.targetRepsMax ?? null, target_duration_seconds: step.targetDurationSeconds ?? null,
  target_distance_m: step.targetDistanceM ?? null, target_weight_kg: step.targetWeightKg ?? null,
  rest_seconds: step.restSeconds, notes: step.notes ?? null,
}));

export async function saveTrainerAssignedWorkoutPlan(userId: string, linkId: string, draft: WorkoutPlanDraft): Promise<string> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_trainer_assigned_workout_plan', {
    p_link_id: linkId, p_plan_id: draft.id ?? null, p_name: draft.name, p_description: draft.description ?? null,
    p_level: draft.level ?? null, p_estimated_duration_minutes: draft.estimatedDurationMinutes ?? null, p_steps: toRpcSteps(draft.steps),
  });
  if (error || !data) throw error ?? new Error('Не удалось сохранить план');
  return String(data);
}

export async function saveTrainerAssignedWorkoutPlanV2(userId: string, linkId: string, draft: SourceAwareWorkoutPlanDraft): Promise<SourceAwareWorkoutPlan> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_trainer_assigned_workout_plan_v2', {
    p_link_id: linkId, p_plan_id: draft.id ?? null, p_name: draft.name,
    p_description: draft.description ?? null, p_level: draft.level ?? null,
    p_estimated_duration_minutes: draft.estimatedDurationMinutes ?? null, p_steps: toV2RpcSteps(draft.steps),
  });
  if (error) throw error;
  return toSourceAwarePlan(data);
}

export async function saveTrainerAssignedWorkoutPlanV3(userId: string, linkId: string, draft: SourceAwareWorkoutPlanDraftV3): Promise<SourceAwareWorkoutPlanV3> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_trainer_assigned_workout_plan_v3', {
    p_link_id: linkId, p_plan_id: draft.id ?? null, p_name: draft.name,
    p_description: draft.description ?? null, p_level: draft.level ?? null,
    p_estimated_duration_minutes: draft.estimatedDurationMinutes ?? null, p_steps: toV3RpcSteps(draft.steps),
  });
  if (error) throw error;
  return toSourceAwarePlanV3(data);
}

export async function archiveTrainerAssignedWorkoutPlan(userId: string, linkId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('archive_trainer_assigned_workout_plan', { p_link_id: linkId, p_plan_id: planId });
  if (error) throw error;
}

export async function deleteTrainerAssignedWorkoutPlan(userId: string, linkId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('delete_trainer_assigned_workout_plan_v3', { p_link_id: linkId, p_plan_id: planId });
  if (error) throw error;
}

function toPlan(data: unknown): WorkoutPlan {
  const value = record(data);
  return {
    id: String(value.id), name: String(value.name ?? 'План'), description: value.description == null ? null : String(value.description),
    level: value.level == null ? null : String(value.level), estimatedDurationMinutes: nullableNumber(value.estimated_duration_minutes),
    exerciseCount: Array.isArray(value.exercises) ? value.exercises.length : 0, isActive: Boolean(value.is_active), updatedAt: '',
    origin: value.plan_origin === 'trainer_assigned' ? 'trainer_assigned' : 'personal',
    trainerId: value.assigned_by_trainer_id == null ? null : String(value.assigned_by_trainer_id),
    trainerName: value.trainer_name == null ? null : String(value.trainer_name),
    exercises: Array.isArray(value.exercises) ? value.exercises.map(toStep) : [],
  };
}

function toSourceAwarePlan(data: unknown): SourceAwareWorkoutPlan {
  const value = record(data);
  const plan = toPlan(data);
  return { ...plan, exercises: Array.isArray(value.exercises) ? value.exercises.map(toSourceAwareStep) : [] };
}

function toSourceAwarePlanV3(data: unknown): SourceAwareWorkoutPlanV3 {
  const value = record(data);
  const plan = toPlan(data);
  return { ...plan, exercises: Array.isArray(value.exercises) ? value.exercises.map(toSourceAwareStepV3) : [] };
}

export async function startPersonalWorkout(userId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('start_personal_workout', { p_plan_id: planId });
  if (error) throw error;
  return toSession(data);
}

export async function startPersonalWorkoutV2(userId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('start_personal_workout_v2', { p_plan_id: planId });
  if (error) throw error;
  return toSourceAwareSession(data);
}

export async function startPersonalWorkoutV3(userId: string, planId: string) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('start_personal_workout_v3', { p_plan_id: planId });
  if (error) throw error;
  return toSourceAwareSessionV3(data);
}

export async function loadWorkoutSessionV3(userId: string, sessionId: string): Promise<SourceAwareWorkoutSessionV3> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_session_v3', { p_session_id: sessionId });
  if (error) throw error;
  return toSourceAwareSessionV3(data);
}

// Kept separate from the legacy active-session reader until Workout Engine V3
// switches execution to the V3 contract. The RPC returns a client-safe,
// source-aware snapshot including immutable planned sets.
export async function loadActiveWorkoutSessionV3(userId: string): Promise<SourceAwareWorkoutSessionV3 | null> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_active_workout_session_v3');
  if (error) throw error;
  return data == null ? null : toSourceAwareSessionV3(data);
}

export async function loadWorkoutExecutionCheckpoint(userId: string, sessionId: string): Promise<WorkoutExecutionCheckpoint | null> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('get_my_workout_execution_checkpoint', { p_session_id: sessionId });
  if (error) throw error;
  return data == null ? null : toWorkoutExecutionCheckpoint(data);
}

export async function saveWorkoutExecutionCheckpoint(userId: string, input: SaveWorkoutExecutionCheckpointInput): Promise<WorkoutExecutionCheckpoint> {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_my_workout_execution_checkpoint', {
    p_session_id: input.workoutSessionId, p_session_step_id: input.sessionStepId, p_set_number: input.setNumber,
    p_phase: input.phase, p_duration_accumulated_seconds: input.durationAccumulatedSeconds,
    p_duration_started_at: input.durationStartedAt, p_duration_is_manual: input.durationIsManual,
    p_rest_ends_at: input.restEndsAt, p_rest_total_seconds: input.restTotalSeconds,
    p_draft_reps: input.draftReps, p_draft_weight_kg: input.draftWeightKg,
    p_draft_duration_seconds: input.draftDurationSeconds, p_draft_distance_m: input.draftDistanceM,
    p_draft_rpe: input.draftRpe, p_draft_notes: input.draftNotes, p_client_set_key: input.clientSetKey,
    p_revision: input.revision,
  });
  if (error) throw error;
  return toWorkoutExecutionCheckpoint(data);
}

export async function clearWorkoutExecutionCheckpoint(userId: string, sessionId: string, revision: number | null) {
  const client = await getSupabaseClientForUser(userId);
  const { error } = await client.rpc('clear_my_workout_execution_checkpoint', { p_session_id: sessionId, p_revision: revision });
  if (error) throw error;
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

export async function savePerformedSetV2(userId: string, input: SavePerformedSetInput) {
  const client = await getSupabaseClientForUser(userId);
  const { data, error } = await client.rpc('save_my_performed_set_v2', {
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
