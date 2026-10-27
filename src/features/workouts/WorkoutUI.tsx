import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ArrowLeft, Check, ChevronRight, Dumbbell, LoaderCircle, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, SkipForward, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Progress } from '@/components/ui/progress';
import {
  completeWorkoutSession,
  loadWorkoutExecutionCheckpoint,
  loadActiveWorkoutSessionV3,
  loadWorkoutHistory,
  loadWorkoutPlanV3,
  loadWorkoutPlans,
  loadWorkoutSessionV3,
  saveMyWorkoutPlanV3,
  archiveMyWorkoutPlan,
  deleteMyWorkoutPlan,
  duplicateMyWorkoutPlan,
  savePerformedSet,
  saveWorkoutExecutionCheckpoint,
  startPersonalWorkoutV3,
  type WorkoutHistoryItem,
  type WorkoutPlan,
  type SourceAwareWorkoutPlan, type SourceAwareWorkoutPlanDraftV3, type SourceAwareWorkoutPlanV3,
  type SourceAwareWorkoutPlanStepV3,
  type SourceAwareWorkoutSessionV3,
  type WorkoutPlanSetTarget,
  type WorkoutExecutionCheckpoint,
  type WorkoutPlanSummary,
  type WorkoutPlanStep,
} from './repository';
import { PersonalPlanEditorV2 } from './PersonalPlanEditorV2';
import { CircularWorkoutTimer } from './CircularWorkoutTimer';
import { MinutesSecondsInput } from './MinutesSecondsInput';
import { restTimerProgress, workTimerProgress } from './circularTimer';
import { elapsedDurationSeconds, elapsedDurationSecondsPrecise, pauseDurationClock, remainingRestSeconds, remainingRestSecondsPrecise, startDurationClock, type DurationClock } from './timer';

const dateLabel = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(value));
const timerLabel = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value);

const measurementLabel = (measurementType: WorkoutPlanStep['measurementType']) => ({ reps: 'Повторения', duration: 'Длительность', distance: 'Дистанция' })[measurementType];

function plannedSetLabel(step: Pick<WorkoutPlanStep, 'measurementType'>, plannedSet: WorkoutPlanSetTarget) {
  const targets: string[] = [];
  if (step.measurementType === 'reps') {
    if (plannedSet.targetRepsMin != null) {
      targets.push(plannedSet.targetRepsMax != null && plannedSet.targetRepsMax !== plannedSet.targetRepsMin
        ? `${plannedSet.targetRepsMin}–${plannedSet.targetRepsMax} повторений`
        : `${plannedSet.targetRepsMin} повторений`);
    }
    if (plannedSet.targetWeightKg != null) targets.push(`${plannedSet.targetWeightKg} кг`);
  }
  if (step.measurementType === 'duration' && plannedSet.targetDurationSeconds != null) targets.push(timerLabel(plannedSet.targetDurationSeconds));
  if (step.measurementType === 'distance') {
    if (plannedSet.targetDistanceM != null) targets.push(`${plannedSet.targetDistanceM} м`);
    if (plannedSet.targetDurationSeconds != null) targets.push(`Время ${timerLabel(plannedSet.targetDurationSeconds)}`);
  }
  return targets.length ? targets.join(' · ') : null;
}

function planStepSummary(step: SourceAwareWorkoutPlanStepV3) {
  const plannedSets = orderedPlannedSets(step);
  const targets = plannedSets
    .map((plannedSet) => plannedSetLabel(step, plannedSet))
    .filter((target): target is string => Boolean(target));
  const setCount = `${plannedSets.length} ${plannedSets.length === 1 ? 'подход' : plannedSets.length < 5 ? 'подхода' : 'подходов'}`;
  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length === 1) return `${setCount} · ${uniqueTargets[0]}`;
  if (plannedSets.length <= 3 && targets.length === plannedSets.length) return `${setCount} · ${targets.map((target, index) => `${index + 1}: ${target}`).join(' · ')}`;
  return uniqueTargets.length ? `${setCount} · индивидуальные цели` : setCount;
}

type InlineSetDraft = Omit<WorkoutPlanSetTarget, 'setNumber'>;
type DeletedInlineSet = { set: InlineSetDraft; index: number } | null;
type InlineExerciseEdit = {
  stepId: string;
  basePlanFingerprint: string;
  notes: string;
  plannedSets: InlineSetDraft[];
  deletedSet: DeletedInlineSet;
};

const editableSet = (set: WorkoutPlanSetTarget): InlineSetDraft => ({
  setId: set.setId,
  targetRepsMin: set.targetRepsMin,
  targetRepsMax: set.targetRepsMax,
  targetDurationSeconds: set.targetDurationSeconds,
  targetDistanceM: set.targetDistanceM,
  targetWeightKg: set.targetWeightKg,
  restSeconds: set.restSeconds,
});

const planFingerprint = (plan: SourceAwareWorkoutPlanV3) => JSON.stringify({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  level: plan.level,
  estimatedDurationMinutes: plan.estimatedDurationMinutes,
  exercises: plan.exercises.map((step) => ({
    stepId: step.stepId,
    sourceKind: step.exerciseSourceKind,
    sourceId: step.exerciseSourceId,
    dayNumber: step.dayNumber,
    sortOrder: step.sortOrder,
    notes: step.notes,
    plannedSets: orderedPlannedSets(step).map((set) => ({ ...editableSet(set), setNumber: set.setNumber })),
  })),
});

const inlineEditFingerprint = (edit: Pick<InlineExerciseEdit, 'notes' | 'plannedSets'>) => JSON.stringify({
  notes: edit.notes,
  plannedSets: edit.plannedSets,
});

function initialInlineSet(measurementType: WorkoutPlanStep['measurementType']): InlineSetDraft {
  return {
    setId: null,
    targetRepsMin: measurementType === 'reps' ? 10 : null,
    targetRepsMax: null,
    targetDurationSeconds: measurementType === 'duration' ? 30 : null,
    targetDistanceM: measurementType === 'distance' ? 1000 : null,
    targetWeightKg: null,
    restSeconds: 60,
  };
}

function inlineEditError(step: Pick<WorkoutPlanStep, 'measurementType'>, plannedSets: InlineSetDraft[]) {
  if (plannedSets.length < 1 || plannedSets.length > 100) return 'В упражнении должен быть от 1 до 100 подходов.';
  for (const plannedSet of plannedSets) {
    const numeric = [plannedSet.targetRepsMin, plannedSet.targetRepsMax, plannedSet.targetDurationSeconds, plannedSet.targetDistanceM, plannedSet.targetWeightKg, plannedSet.restSeconds];
    if (numeric.some((value) => value != null && (!Number.isFinite(value) || value < 0))) return 'Введите допустимые неотрицательные значения.';
    if (plannedSet.restSeconds != null && (!Number.isInteger(plannedSet.restSeconds) || plannedSet.restSeconds > 3600)) return 'Отдых указывается целым числом от 0 до 3600 секунд.';
    if (step.measurementType === 'reps' && (plannedSet.targetRepsMin == null || plannedSet.targetRepsMin < 1 || plannedSet.targetDurationSeconds != null || plannedSet.targetDistanceM != null)) return 'Для повторений укажите минимум 1 повторение.';
    if (step.measurementType === 'reps' && plannedSet.targetRepsMax != null && plannedSet.targetRepsMax < (plannedSet.targetRepsMin ?? 0)) return 'Максимум повторений не может быть меньше минимума.';
    if (step.measurementType === 'duration' && (plannedSet.targetDurationSeconds == null || plannedSet.targetDurationSeconds < 1 || plannedSet.targetDistanceM != null || plannedSet.targetRepsMin != null || plannedSet.targetRepsMax != null || plannedSet.targetWeightKg != null)) return 'Для длительности укажите время не менее одной секунды.';
    if (step.measurementType === 'distance' && ((plannedSet.targetDistanceM ?? 0) < 1 && (plannedSet.targetDurationSeconds ?? 0) < 1 || plannedSet.targetRepsMin != null || plannedSet.targetRepsMax != null || plannedSet.targetWeightKg != null)) return 'Для дистанции укажите метры или плановое время.';
  }
  return null;
}

function planDraftWithInlineExercise(plan: SourceAwareWorkoutPlanV3, edited: InlineExerciseEdit): SourceAwareWorkoutPlanDraftV3 {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    level: plan.level as SourceAwareWorkoutPlanDraftV3['level'],
    estimatedDurationMinutes: plan.estimatedDurationMinutes,
    steps: plan.exercises.map((step) => ({
      stepId: step.stepId,
      exerciseSourceKind: null,
      exerciseSourceId: null,
      dayNumber: step.dayNumber,
      notes: step.stepId === edited.stepId ? (edited.notes.trim() || null) : step.notes,
      plannedSets: (step.stepId === edited.stepId ? edited.plannedSets : orderedPlannedSets(step)).map((plannedSet) => ({
        setId: plannedSet.setId,
        targetRepsMin: plannedSet.targetRepsMin,
        targetRepsMax: plannedSet.targetRepsMax,
        targetDurationSeconds: plannedSet.targetDurationSeconds,
        targetDistanceM: plannedSet.targetDistanceM,
        targetWeightKg: plannedSet.targetWeightKg,
        restSeconds: plannedSet.restSeconds,
      })),
    })),
  };
}

type WorkoutEngineStep = SourceAwareWorkoutPlanStepV3 & { plannedSets: WorkoutPlanSetTarget[] };
type WorkoutEngineSession = Omit<SourceAwareWorkoutSessionV3, 'planSnapshot'> & { planSnapshot: WorkoutEngineStep[] };
type WorkoutEnginePosition = { exerciseIndex: number; plannedSetIndex: number; setNumber: number };
type WorkoutExecutionPhase = 'ready' | 'active' | 'paused' | 'rest' | 'next' | 'complete';

function orderedPlannedSets(step: SourceAwareWorkoutPlanStepV3): WorkoutPlanSetTarget[] {
  if (step.plannedSets.length) return [...step.plannedSets].sort((left, right) => left.setNumber - right.setNumber);
  return Array.from({ length: Math.max(0, step.targetSets) }, (_, index) => ({
    setId: null,
    setNumber: index + 1,
    targetRepsMin: step.targetRepsMin,
    targetRepsMax: step.targetRepsMax,
    targetDurationSeconds: step.targetDurationSeconds,
    targetDistanceM: step.targetDistanceM,
    targetWeightKg: step.targetWeightKg,
    restSeconds: step.restSeconds,
  }));
}

function engineSession(session: SourceAwareWorkoutSessionV3): WorkoutEngineSession {
  return { ...session, planSnapshot: session.planSnapshot.map((step) => ({ ...step, plannedSets: orderedPlannedSets(step) })) };
}

function plannedTargetLabel(step: Pick<WorkoutPlanStep, 'measurementType'>, plannedSet: WorkoutPlanSetTarget) {
  if (step.measurementType === 'duration') return `${plannedSet.targetDurationSeconds ?? '—'} сек`;
  if (step.measurementType === 'distance') return `${plannedSet.targetDistanceM ?? '—'} м`;
  const reps = plannedSet.targetRepsMax && plannedSet.targetRepsMax !== plannedSet.targetRepsMin ? `${plannedSet.targetRepsMin}–${plannedSet.targetRepsMax}` : plannedSet.targetRepsMin;
  return `${reps ?? '—'} повторений${plannedSet.targetWeightKg != null ? ` · ${plannedSet.targetWeightKg} кг` : ''}`;
}

function actualDraftLabel(step: Pick<WorkoutPlanStep, 'measurementType'>, values: { reps: string; weight: string; duration: string; distance: string; notes: string; rpe: string }) {
  const parts: string[] = [];
  if (step.measurementType === 'reps' && values.reps.trim()) parts.push(`${values.reps.trim()} повторений`);
  if (values.weight.trim()) parts.push(`${values.weight.trim()} кг`);
  if (step.measurementType === 'duration' && values.duration.trim()) parts.push(`${values.duration.trim()} сек`);
  if (step.measurementType === 'distance' && values.distance.trim()) parts.push(`${values.distance.trim()} м`);
  if (values.rpe.trim()) parts.push(`RPE ${values.rpe.trim()}`);
  if (values.notes.trim()) parts.push('есть заметка');
  return parts.length ? parts.join(' · ') : 'Значения не указаны';
}

function sessionNext(session: WorkoutEngineSession): WorkoutEnginePosition | null {
  const done = new Set(session.sets.filter((item) => item.isCompleted && item.sessionStepId).map((item) => `${item.sessionStepId}:${item.setNumber}`));
  for (let index = 0; index < session.planSnapshot.length; index += 1) {
    const step = session.planSnapshot[index];
    for (let plannedSetIndex = 0; plannedSetIndex < step.plannedSets.length; plannedSetIndex += 1) {
      const plannedSet = step.plannedSets[plannedSetIndex];
      if (!done.has(`${step.stepId}:${plannedSet.setNumber}`)) return { exerciseIndex: index, plannedSetIndex, setNumber: plannedSet.setNumber };
    }
  }
  return null;
}

function phaseAfterRest(position: WorkoutEnginePosition): Extract<WorkoutExecutionPhase, 'ready' | 'next'> {
  return position.plannedSetIndex === 0 ? 'next' : 'ready';
}

function setFor(session: WorkoutEngineSession, stepId: string, setNumber: number) {
  return session.sets.find((item) => item.sessionStepId === stepId && item.setNumber === setNumber) ?? null;
}

function PlanDetailDrawer({ userId, planId, open, onOpenChange, onStart, onEdit, onDuplicate, onArchive, onDelete }: { userId: string; planId: string | null; open: boolean; onOpenChange: (open: boolean) => void; onStart: (session: WorkoutEngineSession) => void; onEdit: (plan: SourceAwareWorkoutPlan) => void; onDuplicate: (plan: Pick<WorkoutPlan, 'id' | 'origin' | 'name'>) => void; onArchive: (plan: Pick<WorkoutPlan, 'id' | 'origin' | 'name'>) => void; onDelete: (plan: Pick<WorkoutPlan, 'id' | 'origin' | 'name'>) => void }) {
  const [plan, setPlan] = useState<SourceAwareWorkoutPlanV3 | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [detailStepId, setDetailStepId] = useState<string | null>(null);
  const [editing, setEditing] = useState<InlineExerciseEdit | null>(null);
  const [savingExercise, setSavingExercise] = useState(false);
  const [editError, setEditError] = useState('');
  const [conflictingPlan, setConflictingPlan] = useState<SourceAwareWorkoutPlanV3 | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState<'detail' | 'drawer' | 'edit' | null>(null);
  const [restorePlanFocus, setRestorePlanFocus] = useState(false);
  const drawerBodyRef = useRef<HTMLDivElement | null>(null);
  const detailFocusRef = useRef<HTMLElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const exerciseTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailReturnStepIdRef = useRef<string | null>(null);
  const planScrollTopRef = useRef(0);

  useEffect(() => {
    if (!open || !planId) return;
    setLoading(true); setError(''); setActionsOpen(false); setDetailStepId(null); setEditing(null); setEditError(''); setConflictingPlan(null); setDiscardPrompt(null); setPlan(null);
    void loadWorkoutPlanV3(userId, planId).then(setPlan).catch(() => setError('Не удалось загрузить план.')).finally(() => setLoading(false));
  }, [open, planId, userId]);

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [actionsOpen]);

  const detailStep = plan?.exercises.find((step) => step.stepId === detailStepId) ?? null;
  useEffect(() => {
    if (!detailStep) return;
    const frame = window.requestAnimationFrame(() => detailFocusRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detailStep]);

  useEffect(() => {
    if (detailStep || !restorePlanFocus) return;
    const timer = window.setTimeout(() => {
      if (drawerBodyRef.current) drawerBodyRef.current.scrollTop = planScrollTopRef.current;
      const stepId = detailReturnStepIdRef.current;
      if (stepId) exerciseTriggerRefs.current.get(stepId)?.focus();
      setRestorePlanFocus(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [detailStep, restorePlanFocus]);

  const closeExerciseDetail = useCallback(() => {
    setEditing(null); setEditError(''); setConflictingPlan(null); setDiscardPrompt(null);
    setRestorePlanFocus(true);
    setDetailStepId(null);
  }, []);

  const beginExerciseEdit = () => {
    if (!plan || !detailStep || plan.origin !== 'personal') return;
    const draft: InlineExerciseEdit = {
      stepId: detailStep.stepId,
      basePlanFingerprint: planFingerprint(plan),
      notes: detailStep.notes ?? '',
      plannedSets: orderedPlannedSets(detailStep).map(editableSet),
      deletedSet: null,
    };
    setEditing(draft); setEditError(''); setConflictingPlan(null);
  };

  const editChanged = editing ? inlineEditFingerprint(editing) !== JSON.stringify({ notes: detailStep?.notes ?? '', plannedSets: detailStep ? orderedPlannedSets(detailStep).map(editableSet) : [] }) : false;
  const requestDetailExit = (destination: 'detail' | 'drawer') => {
    if (editing && editChanged) { setDiscardPrompt(destination); return; }
    if (destination === 'detail') closeExerciseDetail(); else onOpenChange(false);
  };
  const requestEditCancel = () => {
    if (editing && editChanged) { setDiscardPrompt('edit'); return; }
    setEditing(null); setEditError(''); setConflictingPlan(null);
  };
  const discardExerciseChanges = () => {
    const destination = discardPrompt;
    setDiscardPrompt(null); setEditing(null); setEditError(''); setConflictingPlan(null);
    if (destination === 'detail') closeExerciseDetail();
    if (destination === 'drawer') onOpenChange(false);
  };

  const updateEditing = (changes: Partial<InlineExerciseEdit>) => setEditing((value) => value ? { ...value, ...changes } : value);
  const updateEditingSet = (index: number, changes: Partial<InlineSetDraft>) => setEditing((value) => value ? { ...value, plannedSets: value.plannedSets.map((plannedSet, setIndex) => setIndex === index ? { ...plannedSet, ...changes } : plannedSet), deletedSet: value.deletedSet } : value);
  const addEditingSet = () => setEditing((value) => {
    if (!value || !detailStep) return value;
    const previous = value.plannedSets.at(-1);
    return { ...value, plannedSets: [...value.plannedSets, previous ? { ...previous, setId: null } : initialInlineSet(detailStep.measurementType)], deletedSet: null };
  });
  const removeEditingSet = (index: number) => setEditing((value) => {
    if (!value || value.plannedSets.length <= 1) return value;
    const removed = value.plannedSets[index];
    return removed ? { ...value, plannedSets: value.plannedSets.filter((_, setIndex) => setIndex !== index), deletedSet: { set: removed, index } } : value;
  });
  const undoEditingSet = () => setEditing((value) => !value?.deletedSet ? value : {
    ...value,
    plannedSets: [...value.plannedSets.slice(0, value.deletedSet.index), value.deletedSet.set, ...value.plannedSets.slice(value.deletedSet.index)],
    deletedSet: null,
  });

  const saveExerciseEdit = async () => {
    if (!plan || !detailStep || !editing || savingExercise) return;
    const validationError = inlineEditError(detailStep, editing.plannedSets);
    if (validationError) { setEditError(validationError); return; }
    if (editing.notes.length > 1000) { setEditError('Заметка не может быть длиннее 1000 символов.'); return; }
    setSavingExercise(true); setEditError(''); setConflictingPlan(null);
    try {
      const latest = await loadWorkoutPlanV3(userId, plan.id);
      if (planFingerprint(latest) !== editing.basePlanFingerprint) {
        setConflictingPlan(latest);
        setEditError('План изменён в другом окне. Сохранение остановлено, чтобы не потерять чужие изменения.');
        return;
      }
      const saved = await saveMyWorkoutPlanV3(userId, planDraftWithInlineExercise(latest, editing));
      setPlan(saved); setEditing(null); setEditError('');
    } catch {
      setEditError('Не удалось сохранить упражнение. Черновик остался на экране — повторите попытку.');
    } finally {
      setSavingExercise(false);
    }
  };

  const start = async () => {
    if (!planId || starting) return;
    setStarting(true); setError('');
    try { const session = await startPersonalWorkoutV3(userId, planId); onOpenChange(false); onStart(engineSession(session)); }
    catch { setError('Не удалось начать тренировку. Проверьте соединение и повторите.'); }
    finally { setStarting(false); }
  };
  const chooseAction = (action: (value: SourceAwareWorkoutPlan) => void) => { if (!plan) return; setActionsOpen(false); action(plan); };
  const assigned = plan?.origin === 'trainer_assigned';
  const closeDrawer = (nextOpen: boolean) => {
    if (!nextOpen && detailStep) { requestDetailExit('detail'); return; }
    onOpenChange(nextOpen);
  };
  const openExerciseDetail = (step: SourceAwareWorkoutPlanStepV3) => {
    planScrollTopRef.current = drawerBodyRef.current?.scrollTop ?? 0;
    detailReturnStepIdRef.current = step.stepId;
    setActionsOpen(false);
    setDetailStepId(step.stepId);
  };

  return <Drawer open={open} onOpenChange={closeDrawer}>
    <DrawerContent className="flux-drawer flux-workout-plan-drawer">
      <DrawerHeader className="flux-drawer-header">
        <button type="button" className="flux-drawer-back" onClick={() => detailStep ? requestDetailExit('detail') : onOpenChange(false)} aria-label={detailStep ? 'Назад к плану' : 'Назад к тренировкам'}><ArrowLeft /></button>
        <div className="flux-plan-drawer-title">
          <DrawerTitle>{detailStep?.name ?? plan?.name ?? 'План тренировки'}</DrawerTitle>
          <DrawerDescription>{detailStep ? `План: ${plan?.name ?? ''}` : plan?.description ?? (assigned ? 'План от тренера' : 'Личный план')}</DrawerDescription>
        </div>
        {plan && !assigned && !detailStep ? <div className="flux-plan-actions" ref={actionsRef}><button type="button" className="flux-drawer-back" aria-label="Действия плана" aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen((value) => !value)}><MoreHorizontal /></button>{actionsOpen && <div className="flux-plan-actions-menu" role="menu"><button type="button" role="menuitem" onClick={() => chooseAction(onEdit)}>Редактировать</button><button type="button" role="menuitem" onClick={() => chooseAction(onDuplicate)}>Создать копию</button>{plan.isActive && <button type="button" role="menuitem" onClick={() => chooseAction(onArchive)}>В архив</button>}<button type="button" className="is-destructive" role="menuitem" onClick={() => chooseAction(onDelete)}>Удалить план</button></div>}</div> : <span aria-hidden="true" className="flux-plan-drawer-header-spacer" />}
      </DrawerHeader>
      <div ref={drawerBodyRef} className="flux-workout-drawer-body" onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && actionsOpen) { event.preventDefault(); event.stopPropagation(); setActionsOpen(false); }
        if (event.key === 'Escape' && detailStep) { event.preventDefault(); event.stopPropagation(); requestDetailExit('detail'); }
      }}>
        {loading ? <p className="flux-trainer-empty">Загружаем план…</p> : error && !plan ? <p className="flux-client-inline-error">{error}</p> : detailStep ? <ExercisePlanDetail step={detailStep} focusRef={detailFocusRef} canEdit={plan?.origin === 'personal'} editing={editing} saving={savingExercise} error={editError} conflict={Boolean(conflictingPlan)} onBeginEdit={beginExerciseEdit} onUpdate={updateEditing} onUpdateSet={updateEditingSet} onAddSet={addEditingSet} onRemoveSet={removeEditingSet} onUndoSet={undoEditingSet} onSave={() => { void saveExerciseEdit(); }} onCancel={requestEditCancel} onReloadConflict={() => { if (!conflictingPlan) return; setPlan(conflictingPlan); setEditing(null); setEditError(''); setConflictingPlan(null); }} /> : plan ? <>
          <section className="flux-plan-overview"><span className="flux-eyebrow">{assigned ? `От тренера${plan.trainerName ? ` · ${plan.trainerName}` : ''}` : 'Личный план'}{plan.level ? ` · ${plan.level}` : ''}</span><p>{plan.estimatedDurationMinutes ? `${plan.estimatedDurationMinutes} мин` : 'Длительность не указана'} · {plan.exercises.length} упражнений</p></section>
          {plan.exercises.length ? <section className="flux-exercise-list"><div className="flux-section-heading"><h2>Упражнения</h2><span>{plan.exercises.length}</span></div>{plan.exercises.map((step, index) => <button type="button" className="flux-plan-exercise-row" key={step.stepId} aria-label={`Открыть ${step.name}`} ref={(element) => { if (element) exerciseTriggerRefs.current.set(step.stepId, element); else exerciseTriggerRefs.current.delete(step.stepId); }} onClick={() => openExerciseDetail(step)}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{step.name}</strong><small>{planStepSummary(step)}</small></p><ChevronRight /></button>)}</section> : <p className="flux-trainer-empty">В этом плане пока нет упражнений.</p>}
          {error && <p className="flux-client-inline-error">{error}</p>}
          <Button className="flux-main-button" size="lg" disabled={starting || plan.exercises.length === 0 || !plan.isActive} onClick={() => { void start(); }}>{starting ? <LoaderCircle className="is-spinning" /> : <Play />} {plan.isActive ? (starting ? 'Запускаю…' : 'Начать тренировку') : 'План в архиве'}</Button>
        </> : null}
        {discardPrompt && <section className="flux-inline-edit-confirm" role="alertdialog" aria-label="Отменить изменения упражнения?"><p>Несохранённые изменения упражнения будут потеряны.</p><div><Button type="button" variant="secondary" onClick={() => setDiscardPrompt(null)}>Продолжить редактирование</Button><Button type="button" onClick={discardExerciseChanges}>Отменить изменения</Button></div></section>}
      </div>
    </DrawerContent>
  </Drawer>;
}

function ExercisePlanDetail({ step, focusRef, canEdit, editing, saving, error, conflict, onBeginEdit, onUpdate, onUpdateSet, onAddSet, onRemoveSet, onUndoSet, onSave, onCancel, onReloadConflict }: { step: SourceAwareWorkoutPlanStepV3; focusRef: RefObject<HTMLElement | null>; canEdit: boolean; editing: InlineExerciseEdit | null; saving: boolean; error: string; conflict: boolean; onBeginEdit: () => void; onUpdate: (changes: Partial<InlineExerciseEdit>) => void; onUpdateSet: (index: number, changes: Partial<InlineSetDraft>) => void; onAddSet: () => void; onRemoveSet: (index: number) => void; onUndoSet: () => void; onSave: () => void; onCancel: () => void; onReloadConflict: () => void }) {
  const plannedSets = orderedPlannedSets(step);
  return <article ref={focusRef} className="flux-plan-exercise-detail" aria-label={`Подробности упражнения: ${step.name}`} tabIndex={-1}>
    <section className="flux-plan-exercise-overview"><span className="flux-eyebrow">{measurementLabel(step.measurementType)}</span></section>
    {!editing && <>{canEdit && <Button type="button" variant="secondary" size="sm" className="flux-inline-exercise-edit" aria-label="Редактировать упражнение" onClick={onBeginEdit}><Pencil /> Редактировать</Button>}{step.instructions && <section className="flux-plan-detail-copy"><h3>Техника выполнения</h3><p>{step.instructions}</p></section>}{step.notes && <section className="flux-plan-detail-copy"><h3>Заметка к упражнению</h3><p>{step.notes}</p></section>}<section className="flux-plan-set-section" aria-labelledby={`planned-sets-${step.stepId}`}><div className="flux-section-heading"><h3 id={`planned-sets-${step.stepId}`}>Плановые подходы</h3><span>{plannedSets.length}</span></div><ol className="flux-plan-set-list">{plannedSets.map((plannedSet) => <li key={plannedSet.setId ?? `${step.stepId}-${plannedSet.setNumber}`}><PlannedSetCard step={step} plannedSet={editableSet(plannedSet)} setNumber={plannedSet.setNumber} editing={false} /></li>)}</ol></section></>}
    {editing && <InlineExerciseEditor step={step} editing={editing} saving={saving} error={error} conflict={conflict} onUpdate={onUpdate} onUpdateSet={onUpdateSet} onAddSet={onAddSet} onRemoveSet={onRemoveSet} onUndoSet={onUndoSet} onSave={onSave} onCancel={onCancel} onReloadConflict={onReloadConflict} />}
  </article>;
}

function PlannedSetCard({ step, plannedSet, setNumber, editing, saving = false, canRemove = true, parseNumber, onUpdate, onRemove }: { step: SourceAwareWorkoutPlanStepV3; plannedSet: InlineSetDraft; setNumber: number; editing: boolean; saving?: boolean; canRemove?: boolean; parseNumber?: (value: string) => number | null; onUpdate?: (changes: Partial<InlineSetDraft>) => void; onRemove?: () => void }) {
  const min = plannedSet.targetRepsMin;
  const max = plannedSet.targetRepsMax;
  const repsText = min != null && max != null && min !== max ? `${min}–${max} повторений` : min != null ? `${min} повторений` : max != null ? `до ${max} повторений` : null;
  const numeric = parseNumber ?? ((value: string) => numberOrNull(value));
  return <article className={`flux-inline-set-card flux-planned-set-row${editing ? ' is-editing' : ''}`} aria-label={`Подход ${setNumber}`}>
    <div className="flux-inline-set-heading"><strong>Подход {setNumber}</strong>{editing && <button type="button" className="flux-set-delete" aria-label={`Удалить подход ${setNumber}`} disabled={saving || !canRemove} onClick={onRemove}><Trash2 aria-hidden="true" /><span>Удалить</span></button>}</div>
    {step.measurementType === 'reps' && <div className="flux-set-primary-grid flux-set-primary-grid-reps">
      {editing ? <fieldset className="flux-set-reps-range"><legend>Повторения</legend><div><label><span>Мин</span><input aria-label={`Минимум повторений, подход ${setNumber}`} inputMode="numeric" autoComplete="off" value={min ?? ''} placeholder="—" disabled={saving} onChange={(event) => onUpdate?.({ targetRepsMin: numeric(event.target.value) })} /></label><span className="flux-set-range-separator" aria-hidden="true">–</span><label><span>Макс</span><input aria-label={`Максимум повторений, подход ${setNumber}`} inputMode="numeric" autoComplete="off" value={max ?? ''} placeholder="—" disabled={saving} onChange={(event) => onUpdate?.({ targetRepsMax: numeric(event.target.value) })} /></label></div></fieldset> : repsText && <div className="flux-set-primary-value"><span>Повторения</span><strong>{repsText}</strong></div>}
      {(plannedSet.targetWeightKg != null || editing) && <label className="flux-set-weight-field"><span>Вес, кг</span>{editing ? <input aria-label={`Вес, кг, подход ${setNumber}`} inputMode="decimal" autoComplete="off" value={plannedSet.targetWeightKg ?? ''} placeholder="—" disabled={saving} onChange={(event) => onUpdate?.({ targetWeightKg: numeric(event.target.value) })} /> : <strong>{plannedSet.targetWeightKg} кг</strong>}</label>}
    </div>}
    {step.measurementType === 'duration' && (editing ? <div className="flux-set-primary-time"><MinutesSecondsInput label="Длительность" value={plannedSet.targetDurationSeconds} onChange={(value) => onUpdate?.({ targetDurationSeconds: value })} minutesAriaLabel={`Длительность: минуты, подход ${setNumber}`} secondsAriaLabel={`Длительность: секунды, подход ${setNumber}`} disabled={saving} compact /></div> : plannedSet.targetDurationSeconds != null && <div className="flux-set-primary-value"><span>Длительность</span><strong>{timerLabel(plannedSet.targetDurationSeconds)}</strong></div>)}
    {step.measurementType === 'distance' && <>
      {editing ? <label className="flux-set-distance-field"><span>Дистанция, м</span><input aria-label={`Дистанция, подход ${setNumber}`} inputMode="decimal" autoComplete="off" value={plannedSet.targetDistanceM ?? ''} placeholder="—" disabled={saving} onChange={(event) => onUpdate?.({ targetDistanceM: numeric(event.target.value) })} /></label> : plannedSet.targetDistanceM != null && <div className="flux-set-primary-value"><span>Дистанция</span><strong>{plannedSet.targetDistanceM} м</strong></div>}
    </>}
    {(editing || plannedSet.restSeconds != null || (step.measurementType === 'distance' && plannedSet.targetDurationSeconds != null)) && <div className={`flux-set-secondary${step.measurementType === 'distance' ? ' is-distance' : ''}`}>
      {step.measurementType === 'distance' && (editing || plannedSet.targetDurationSeconds != null) && <div className="flux-set-secondary-item">{editing ? <MinutesSecondsInput label="Плановая длительность" optional value={plannedSet.targetDurationSeconds} onChange={(value) => onUpdate?.({ targetDurationSeconds: value })} minutesAriaLabel={`Плановая длительность: минуты, подход ${setNumber}`} secondsAriaLabel={`Плановая длительность: секунды, подход ${setNumber}`} disabled={saving} compact /> : <><span>План</span><strong>{timerLabel(plannedSet.targetDurationSeconds!)}</strong></>}</div>}
      {editing ? <div className="flux-set-secondary-item flux-set-rest-input"><MinutesSecondsInput label="Отдых" optional value={plannedSet.restSeconds} onChange={(value) => onUpdate?.({ restSeconds: value })} minutesAriaLabel={`Отдых: минуты, подход ${setNumber}`} secondsAriaLabel={`Отдых: секунды, подход ${setNumber}`} disabled={saving} compact /></div> : plannedSet.restSeconds != null && <div className="flux-set-secondary-view"><span>Отдых</span>{' '}<strong>{plannedSet.restSeconds === 0 ? 'Без отдыха' : timerLabel(plannedSet.restSeconds)}</strong></div>}
    </div>}
  </article>;
}

function InlineExerciseEditor({ step, editing, saving, error, conflict, onUpdate, onUpdateSet, onAddSet, onRemoveSet, onUndoSet, onSave, onCancel, onReloadConflict }: { step: SourceAwareWorkoutPlanStepV3; editing: InlineExerciseEdit; saving: boolean; error: string; conflict: boolean; onUpdate: (changes: Partial<InlineExerciseEdit>) => void; onUpdateSet: (index: number, changes: Partial<InlineSetDraft>) => void; onAddSet: () => void; onRemoveSet: (index: number) => void; onUndoSet: () => void; onSave: () => void; onCancel: () => void; onReloadConflict: () => void }) {
  const numeric = (value: string) => { const trimmed = value.trim(); if (!trimmed) return null; const parsed = Number(trimmed.replace(',', '.')); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };
  return <form className="flux-inline-exercise-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <label className="flux-workout-field flux-inline-note-field"><span>Заметка к упражнению <small>необязательно</small></span><textarea aria-label="Заметка к упражнению" placeholder="Добавьте заметку к упражнению…" value={editing.notes} maxLength={1000} disabled={saving} onChange={(event) => onUpdate({ notes: event.target.value })} /></label>
    <section className="flux-plan-set-section" aria-labelledby={`edit-planned-sets-${step.stepId}`}>
      <div className="flux-section-heading"><h3 id={`edit-planned-sets-${step.stepId}`}>Плановые подходы</h3><span>{editing.plannedSets.length}</span></div>
      {editing.deletedSet && <p className="flux-set-undo" role="status">Подход удалён <button type="button" onClick={onUndoSet} disabled={saving}><RotateCcw aria-hidden="true" /> Отменить</button></p>}
      <ol className="flux-plan-set-list flux-inline-set-list">{editing.plannedSets.map((plannedSet, index) => <li key={plannedSet.setId ?? `new-${index}`}><PlannedSetCard step={step} plannedSet={plannedSet} setNumber={index + 1} editing saving={saving} canRemove={editing.plannedSets.length > 1} parseNumber={numeric} onUpdate={(changes) => onUpdateSet(index, changes)} onRemove={() => onRemoveSet(index)} /></li>)}</ol>
      <button type="button" className="flux-add-set" disabled={saving || editing.plannedSets.length >= 100} onClick={onAddSet}><Plus aria-hidden="true" /> Добавить подход</button>
    </section>
    {error && <p className="flux-client-inline-error" role="alert">{error}</p>}
    {conflict && <Button type="button" variant="secondary" onClick={onReloadConflict}>Перезагрузить данные</Button>}
    <div className="flux-inline-edit-actions"><Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>Отмена</Button><Button type="submit" aria-label={saving ? 'Сохранение изменений' : 'Сохранить изменения'} disabled={saving}>{saving ? <LoaderCircle className="is-spinning" /> : <Check aria-hidden="true" />} {saving ? 'Сохраняем…' : 'Сохранить'}</Button></div>
  </form>;
}

function WorkoutDetailsDrawer({ userId, sessionId, open, onOpenChange }: { userId: string; sessionId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [session, setSession] = useState<WorkoutEngineSession | null>(null); const [error, setError] = useState('');
  useEffect(() => { if (!open || !sessionId) return; setError(''); setSession(null); void loadWorkoutSessionV3(userId, sessionId).then((value) => setSession(engineSession(value))).catch(() => setError('Не удалось открыть результат тренировки.')); }, [open, sessionId, userId]);
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-workout-plan-drawer"><DrawerHeader className="flux-drawer-header"><button type="button" className="flux-drawer-back" onClick={() => onOpenChange(false)} aria-label="Назад к истории"><ArrowLeft /></button><div><DrawerTitle>{session?.title ?? 'Результат тренировки'}</DrawerTitle><DrawerDescription>{session?.completedAt ? dateLabel(session.completedAt) : 'Загружаем…'}</DrawerDescription></div></DrawerHeader><div className="flux-workout-drawer-body">{error ? <p className="flux-client-inline-error">{error}</p> : !session ? <p className="flux-trainer-empty">Загружаем результат…</p> : <><section className="flux-workout-summary"><div><span>Подходы</span><strong>{session.sets.length}</strong><small>сохранено</small></div><div><span>Время</span><strong>{session.completedAt ? Math.max(1, Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)) : 0}</strong><small>мин</small></div><div><span>Нагрузка</span><strong>{session.overallRpe ?? '—'}</strong><small>RPE</small></div></section><section className="flux-exercise-list"><div className="flux-section-heading"><h2>Фактические подходы</h2><span>{session.sets.length}</span></div>{session.sets.map((item) => <div key={item.id}><span>{item.setNumber}</span><p><strong>{item.exerciseName}</strong><small>{item.reps != null ? `${item.reps} повторений` : item.durationSeconds != null ? `${item.durationSeconds} сек` : item.distanceM != null ? `${item.distanceM} м` : 'Выполнено'}{item.weightKg != null ? ` · ${item.weightKg} кг` : ''}{item.rpe != null ? ` · RPE ${item.rpe}` : ''}</small></p></div>)}</section></>}</div></DrawerContent></Drawer>;
}

function WorkoutEngineFlow({ userId, initialSession, onClose, onFinished }: { userId: string; initialSession: WorkoutEngineSession; onClose: () => void; onFinished: (session: WorkoutEngineSession) => void }) {
  const [session, setSession] = useState(initialSession); const [phase, setPhase] = useState<WorkoutExecutionPhase>('ready');
  const first = sessionNext(initialSession); const [position, setPosition] = useState(first); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [exitOpen, setExitOpen] = useState(false); const [completionOpen, setCompletionOpen] = useState(false); const [completionMode, setCompletionMode] = useState<'draft' | 'empty' | 'retry'>('draft'); const [saveDraftBeforeCompletion, setSaveDraftBeforeCompletion] = useState(true); const [draftTouched, setDraftTouched] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [restTotalSeconds, setRestTotalSeconds] = useState(0);
  const restEndsAt = useRef<number | null>(null);
  const restNextPhase = useRef<Extract<WorkoutExecutionPhase, 'ready' | 'next'>>('ready');
  const durationClock = useRef<DurationClock>({ accumulatedSeconds: 0, startedAtMs: null });
  const [durationElapsedSeconds, setDurationElapsedSeconds] = useState(0);
  const [durationInput, setDurationInput] = useState('');
  const [durationManuallyEdited, setDurationManuallyEdited] = useState(false);
  const [durationEditorOpen, setDurationEditorOpen] = useState(false);
  const [completionFlash, setCompletionFlash] = useState(false);
  const step = position ? session.planSnapshot[position.exerciseIndex] : null;
  const plannedSet = step && position ? step.plannedSets[position.plannedSetIndex] ?? null : null;
  const [reps, setReps] = useState(''); const [weight, setWeight] = useState(''); const [distance, setDistance] = useState(''); const [notes, setNotes] = useState(''); const [setRpe, setSetRpe] = useState(''); const [overallRpe, setOverallRpe] = useState('');
  const clientKey = useRef<string>('');
  const setRpeRef = useRef('');
  const overallRpeRef = useRef('');
  const checkpointRevision = useRef<number | null>(null);
  const hydratedPosition = useRef<string | null>(null);
  const checkpointGeneration = useRef(0);
  const checkpointTimer = useRef<number | null>(null);
  const checkpointWrite = useRef<Promise<void> | null>(null);
  const checkpointWritesBlocked = useRef(false);
  const mutationInFlight = useRef(false);
  const mounted = useRef(true);
  const [checkpointHydrated, setCheckpointHydrated] = useState(false);
  const [checkpointStatus, setCheckpointStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => () => {
    mounted.current = false;
    checkpointWritesBlocked.current = true;
    checkpointGeneration.current += 1;
    if (checkpointTimer.current != null) window.clearTimeout(checkpointTimer.current);
  }, []);

  const cancelPendingCheckpoint = useCallback(() => {
    if (checkpointTimer.current == null) return;
    window.clearTimeout(checkpointTimer.current);
    checkpointTimer.current = null;
  }, []);

  useEffect(() => {
    overallRpeRef.current = '';
    setOverallRpe('');
  }, [session.id]);

  useEffect(() => {
    if (!step || !position || !plannedSet) return;
    const positionKey = `${step.stepId}:${plannedSet.setNumber}`;
    if (hydratedPosition.current === positionKey) {
      hydratedPosition.current = null;
      return;
    }
    const saved = setFor(session, step.stepId, plannedSet.setNumber);
    const savedDuration = saved?.durationSeconds ?? null;
    setReps(saved?.reps?.toString() ?? (step.measurementType === 'reps' ? String(plannedSet.targetRepsMin ?? '') : ''));
    setWeight(saved?.weightKg?.toString() ?? (plannedSet.targetWeightKg?.toString() ?? ''));
    setDurationInput(savedDuration?.toString() ?? '');
    setDurationManuallyEdited(savedDuration != null);
    setDurationEditorOpen(false);
    durationClock.current = { accumulatedSeconds: savedDuration ?? 0, startedAtMs: null };
    setDurationElapsedSeconds(savedDuration ?? 0);
    setDistance(saved?.distanceM?.toString() ?? (step.measurementType === 'distance' ? String(plannedSet.targetDistanceM ?? '') : ''));
    setNotes(saved?.notes ?? '');
    const nextSetRpe = saved?.rpe?.toString() ?? '';
    setRpeRef.current = nextSetRpe;
    setSetRpe(nextSetRpe);
    clientKey.current = saved?.clientSetKey ?? crypto.randomUUID();
    setDraftTouched(false);
  }, [session.id, step?.stepId, plannedSet?.setId, plannedSet?.setNumber, position?.plannedSetIndex]);

  useEffect(() => {
    let cancelled = false;
    setCheckpointHydrated(false); checkpointRevision.current = null;
    void loadWorkoutExecutionCheckpoint(userId, session.id).then((checkpoint) => {
      if (cancelled || !checkpoint) return;
      const nextPosition = session.planSnapshot.reduce<WorkoutEnginePosition | null>((found, item, exerciseIndex) => found ?? (() => {
        const plannedSetIndex = item.plannedSets.findIndex((planned) => planned.setNumber === checkpoint.setNumber && item.stepId === checkpoint.sessionStepId);
        return plannedSetIndex < 0 ? null : { exerciseIndex, plannedSetIndex, setNumber: checkpoint.setNumber };
      })(), null);
      if (!nextPosition) return;
      hydratedPosition.current = `${checkpoint.sessionStepId}:${checkpoint.setNumber}`;
      checkpointRevision.current = checkpoint.revision;
      clientKey.current = checkpoint.clientSetKey;
      setPosition(nextPosition); setPhase(checkpoint.phase);
      setReps(checkpoint.draftReps?.toString() ?? ''); setWeight(checkpoint.draftWeightKg?.toString() ?? '');
      setDistance(checkpoint.draftDistanceM?.toString() ?? ''); setNotes(checkpoint.draftNotes ?? '');
      setSetRpe(checkpoint.draftRpe?.toString() ?? ''); setRpeRef.current = checkpoint.draftRpe?.toString() ?? '';
      setDurationInput(checkpoint.draftDurationSeconds?.toString() ?? ''); setDurationManuallyEdited(checkpoint.durationIsManual); setDurationEditorOpen(checkpoint.durationIsManual);
      durationClock.current = { accumulatedSeconds: checkpoint.durationAccumulatedSeconds, startedAtMs: checkpoint.durationStartedAt ? new Date(checkpoint.durationStartedAt).getTime() : null };
      setDurationElapsedSeconds(elapsedDurationSeconds(durationClock.current, Date.now()));
      restEndsAt.current = checkpoint.restEndsAt ? new Date(checkpoint.restEndsAt).getTime() : null;
      setRestTotalSeconds(checkpoint.restEndsAt ? checkpoint.restTotalSeconds ?? 0 : 0);
      setRemaining(checkpoint.restEndsAt ? remainingRestSeconds(new Date(checkpoint.restEndsAt).getTime(), Date.now()) : 0);
      restNextPhase.current = phaseAfterRest(nextPosition);
      // Checkpoints created before this UI did not record a client-side touch
      // flag. A recovered draft is therefore handled conservatively.
      setDraftTouched(Boolean(checkpoint.draftReps != null || checkpoint.draftWeightKg != null || checkpoint.draftDurationSeconds != null || checkpoint.draftDistanceM != null || checkpoint.draftRpe != null || checkpoint.draftNotes || checkpoint.durationAccumulatedSeconds > 0 || checkpoint.durationStartedAt));
    }).catch(() => { if (!cancelled) setCheckpointStatus('error'); }).finally(() => { if (!cancelled) setCheckpointHydrated(true); });
    return () => { cancelled = true; };
  }, [session.id, session.planSnapshot, userId]);

  const finishRest = useCallback(() => {
    restEndsAt.current = null;
    setRestTotalSeconds(0);
    setRemaining(0);
    setPhase(restNextPhase.current);
  }, []);
  useEffect(() => {
    if (phase !== 'rest' && !(phase === 'active' && step?.measurementType === 'duration')) return;
    const tick = () => {
      const now = Date.now();
      if (phase === 'rest') {
        if (restEndsAt.current == null) return;
        const seconds = remainingRestSeconds(restEndsAt.current, now);
        setRemaining(seconds);
        if (seconds === 0) finishRest();
        return;
      }
      setDurationElapsedSeconds(elapsedDurationSeconds(durationClock.current, now));
    };
    tick();
    const id = window.setInterval(tick, 300);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [finishRest, phase, step?.measurementType]);
  useEffect(() => {
    if (!checkpointHydrated || !step || !plannedSet || !position || phase === 'complete' || saving) return;
    const generation = checkpointGeneration.current;
    const timeout = window.setTimeout(() => {
      if (checkpointTimer.current === timeout) checkpointTimer.current = null;
      if (checkpointWritesBlocked.current || generation !== checkpointGeneration.current) return;
      const startedAt = durationClock.current.startedAtMs == null ? null : new Date(durationClock.current.startedAtMs).toISOString();
      const restAt = restEndsAt.current == null ? null : new Date(restEndsAt.current).toISOString();
      const previous = checkpointWrite.current;
      const write = (async () => {
        // Serialize writes: a later render must use the revision produced by an
        // earlier request, rather than racing it with a stale revision.
        await previous?.catch(() => undefined);
        if (checkpointWritesBlocked.current || generation !== checkpointGeneration.current) return;
        if (mounted.current) setCheckpointStatus('saving');
        try {
          const saved = await saveWorkoutExecutionCheckpoint(userId, {
            workoutSessionId: session.id, sessionStepId: step.stepId, setNumber: plannedSet.setNumber,
            phase,
            durationAccumulatedSeconds: elapsedDurationSeconds(durationClock.current, Date.now()),
            durationStartedAt: startedAt, durationIsManual: durationManuallyEdited, restEndsAt: restAt, restTotalSeconds: restAt ? restTotalSeconds : null,
            draftReps: numberOrNull(reps), draftWeightKg: numberOrNull(weight), draftDurationSeconds: numberOrNull(durationInput),
            draftDistanceM: numberOrNull(distance), draftRpe: numberOrNull(setRpeRef.current), draftNotes: notes || null,
            clientSetKey: clientKey.current, revision: checkpointRevision.current,
          });
          checkpointRevision.current = saved.revision;
          if (mounted.current && !checkpointWritesBlocked.current && generation === checkpointGeneration.current) setCheckpointStatus('saved');
        } catch {
          if (mounted.current && !checkpointWritesBlocked.current && generation === checkpointGeneration.current) setCheckpointStatus('error');
        }
      })();
      checkpointWrite.current = write;
      void write.finally(() => {
        if (checkpointWrite.current === write) checkpointWrite.current = null;
      });
    }, 500);
    checkpointTimer.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (checkpointTimer.current === timeout) checkpointTimer.current = null;
    };
  }, [checkpointHydrated, distance, durationInput, durationManuallyEdited, notes, phase, plannedSet, position, reps, saving, session.id, setRpe, step, userId, weight]);
  const startDuration = () => {
    if (!plannedSet?.targetDurationSeconds) return;
    const now = Date.now();
    durationClock.current = startDurationClock(durationClock.current, now);
    setDurationElapsedSeconds(elapsedDurationSeconds(durationClock.current, now));
    checkpointGeneration.current += 1; setDraftTouched(true); setPhase('active');
  };
  const pauseDuration = () => {
    durationClock.current = pauseDurationClock(durationClock.current, Date.now());
    setDurationElapsedSeconds(elapsedDurationSeconds(durationClock.current, Date.now()));
    checkpointGeneration.current += 1; setDraftTouched(true); setPhase('paused');
  };
  const resetDuration = () => {
    if (phase === 'active') return;
    durationClock.current = { accumulatedSeconds: 0, startedAtMs: null };
    setDurationElapsedSeconds(0);
    setDurationInput('');
    setDurationManuallyEdited(false);
    setDurationEditorOpen(false);
    checkpointGeneration.current += 1;
    setDraftTouched(true);
    setPhase('ready');
  };
  const saveSet = async (): Promise<boolean> => {
    const manualDuration = numberOrNull(durationInput);
    const hasManualDuration = durationManuallyEdited && manualDuration != null && Number.isFinite(manualDuration) && manualDuration >= 0;
    if (!step || !plannedSet || !position || mutationInFlight.current || (step.measurementType === 'duration' && phase === 'ready' && !hasManualDuration)) return false;
    const actualDuration = durationManuallyEdited ? manualDuration : elapsedDurationSeconds(durationClock.current, Date.now());
    const payload = { sessionId: session.id, clientSetKey: clientKey.current, stepId: step.stepId, setNumber: plannedSet.setNumber, reps: numberOrNull(reps), weightKg: numberOrNull(weight), durationSeconds: step.measurementType === 'duration' ? actualDuration : numberOrNull(durationInput), distanceM: numberOrNull(distance), rpe: numberOrNull(setRpeRef.current), notes: notes || null };
    mutationInFlight.current = true;
    checkpointWritesBlocked.current = true;
    checkpointGeneration.current += 1;
    cancelPendingCheckpoint();
    setSaving(true); setError('');
    try {
      // The server clears this set's checkpoint atomically with the performed
      // set. Waiting prevents an already-dispatched draft write from arriving
      // after that cleanup and being rejected as a saved set.
      await checkpointWrite.current?.catch(() => undefined);
      const saved = await savePerformedSet(userId, payload);
      // A green check is a persistence acknowledgement, never an optimistic
      // indication that the request merely started.
      setCompletionFlash(true);
      checkpointRevision.current = null; setCheckpointStatus('idle');
      const next = { ...session, sets: [...session.sets.filter((item) => item.clientSetKey !== saved.clientSetKey), saved] }; const nextPosition = sessionNext(next); setSession(next); setPosition(nextPosition); setDraftTouched(false);
      checkpointWritesBlocked.current = false;
      if (!nextPosition) { setPhase('complete'); return true; }
      const isNewExercise = nextPosition.exerciseIndex !== position.exerciseIndex;
      restNextPhase.current = isNewExercise ? 'next' : 'ready';
      const restSeconds = plannedSet.restSeconds ?? step.restSeconds ?? 0;
      if (restSeconds > 0) {
        restEndsAt.current = Date.now() + restSeconds * 1000;
        setRestTotalSeconds(restSeconds);
        setRemaining(restSeconds);
        setPhase('rest');
      } else setPhase(isNewExercise ? 'next' : 'ready');
      return true;
    } catch {
      checkpointWritesBlocked.current = false;
      setError('Подход не сохранён. Значения остались на экране — повторите отправку.');
      return false;
    } finally {
      mutationInFlight.current = false;
      setSaving(false);
    }
  };
  const complete = async (): Promise<boolean> => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    checkpointWritesBlocked.current = true;
    checkpointGeneration.current += 1;
    cancelPendingCheckpoint();
    setSaving(true); setError('');
    try {
      await checkpointWrite.current?.catch(() => undefined);
      const done = await completeWorkoutSession(userId, session.id, numberOrNull(overallRpeRef.current));
      checkpointRevision.current = null; setCheckpointStatus('idle');
      const completed = { ...session, status: done.status, completedAt: done.completedAt, overallRpe: done.overallRpe, notes: done.notes };
      setSession(completed); onFinished(completed); onClose();
      return true;
    } catch {
      checkpointWritesBlocked.current = false;
      setError('Не удалось завершить тренировку. Повторите попытку.');
      return false;
    } finally {
      mutationInFlight.current = false;
      setSaving(false);
    }
  };
  const totalSets = session.planSnapshot.reduce((sum, item) => sum + item.plannedSets.length, 0); const completeSets = session.sets.filter((item) => item.isCompleted).length;
  const phaseLabel = phase === 'rest' ? 'Отдых' : phase === 'next' ? 'Следующее упражнение' : phase === 'complete' ? 'Результат' : 'Активная тренировка';
  const rpeChoices = [{ label: 'Легко', value: '3' }, { label: 'Нормально', value: '6' }, { label: 'Тяжело', value: '8' }, { label: 'На пределе', value: '10' }];
  const rpeValue = phase === 'complete' ? overallRpe : setRpe;
  const selectRpe = (value: string) => {
    if (phase === 'complete') {
      overallRpeRef.current = value;
      setOverallRpe(value);
      return;
    }
    setRpeRef.current = value;
    setSetRpe(value); setDraftTouched(true);
  };
  const feeling = <fieldset className="flux-feeling"><legend>{phase === 'complete' ? 'Какой была тренировка в целом?' : 'Насколько тяжёлым был этот подход?'}</legend><small>Необязательно</small><div>{rpeChoices.map((item) => <button type="button" key={item.value} className={rpeValue === item.value ? 'is-active' : ''} aria-pressed={rpeValue === item.value} onClick={() => selectRpe(item.value)}>{item.label}</button>)}</div></fieldset>;
  const durationValue = durationManuallyEdited ? durationInput : String(durationElapsedSeconds);
  const hasManualDuration = durationManuallyEdited && numberOrNull(durationInput) != null && Number.isFinite(Number(durationInput)) && Number(durationInput) >= 0;
  const durationReachedPlan = step?.measurementType === 'duration' && plannedSet?.targetDurationSeconds != null && durationElapsedSeconds >= plannedSet.targetDurationSeconds;
  const restProgress = restTimerProgress(remaining, restTotalSeconds);
  const workVisualProgress = useCallback((now: number) => workTimerProgress(elapsedDurationSecondsPrecise(durationClock.current, now), plannedSet?.targetDurationSeconds), [plannedSet?.targetDurationSeconds]);
  const restVisualProgress = useCallback((now: number) => restTimerProgress(remainingRestSecondsPrecise(restEndsAt.current ?? now, now), restTotalSeconds), [restTotalSeconds]);
  useEffect(() => { if (!completionFlash) return; const timeout = window.setTimeout(() => setCompletionFlash(false), 420); return () => window.clearTimeout(timeout); }, [completionFlash]);
  const leave = () => { restEndsAt.current = null; onClose(); };
  const hasSavedSets = completeSets > 0;
  const hasUnsavedDraft = Boolean(step && plannedSet && position && !setFor(session, step.stepId, plannedSet.setNumber) && draftTouched);
  const draftSummary = step ? actualDraftLabel(step, { reps, weight, duration: durationValue, distance, notes, rpe: setRpe }) : '';
  const requestCompletion = () => {
    if (saving || mutationInFlight.current) return;
    setError('');
    if (hasUnsavedDraft) {
      setSaveDraftBeforeCompletion(true);
      setCompletionMode('draft');
      setExitOpen(false);
      setCompletionOpen(true);
      return;
    }
    if (!hasSavedSets) {
      setSaveDraftBeforeCompletion(false);
      setCompletionMode('empty');
      setExitOpen(false);
      setCompletionOpen(true);
      return;
    }
    setExitOpen(false);
    void complete();
  };
  const confirmCompletion = async () => {
    if (saving || mutationInFlight.current) return;
    setError('');
    let savedDraft = false;
    if (completionMode === 'draft' && hasUnsavedDraft && saveDraftBeforeCompletion) {
      const saved = await saveSet();
      if (!saved) return;
      savedDraft = true;
    }
    const completed = await complete();
    if (completed) setCompletionOpen(false);
    else if (savedDraft || completionMode !== 'draft' || !hasUnsavedDraft) setCompletionMode('retry');
  };
  const primarySetAction = step?.measurementType !== 'duration' && phase === 'ready'
    ? <Button className="flux-main-button" size="lg" onClick={() => setPhase('active')}><Play /> Начать подход</Button>
    : (step?.measurementType !== 'duration' || phase === 'active' || phase === 'paused')
      ? <Button className="flux-main-button" size="lg" disabled={saving} onClick={() => { void saveSet(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Завершить подход</Button>
      : step?.measurementType === 'duration'
        ? <Button className="flux-main-button" size="lg" disabled={saving || !hasManualDuration} onClick={() => { void saveSet(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Завершить подход</Button>
        : null;
  const flowHost = document.querySelector<HTMLElement>('.flux-base-app') ?? document.body;
  return createPortal(<section className="flux-workout-flow" role="dialog" aria-modal="true" aria-label="Активная тренировка">
    <header className="flux-flow-header">
      <Button variant="secondary" size="icon" onClick={leave} aria-label="Вернуться к тренировкам"><ArrowLeft /></Button>
      <div><span>{phaseLabel}</span><strong>{phase === 'complete' ? 'Тренировка готова' : step?.name ?? session.title}</strong></div>
      <Button variant="ghost" size="icon" onClick={() => setExitOpen(true)} aria-label="Закрыть"><X /></Button>
    </header>
    {phase === 'complete' ? <div className="flux-flow-content flux-complete-screen">
      <span className="flux-complete-icon"><Check /></span><span className="flux-eyebrow">Все подходы сохранены</span><h1>Тренировка завершена</h1>
      <p>Результаты уже собраны. Когда будете готовы — сохраните их в истории.</p>
      <div className="flux-workout-summary"><div><span>Упражнения</span><strong>{session.planSnapshot.length}</strong><small>в плане</small></div><div><span>Подходы</span><strong>{completeSets}</strong><small>сохранено</small></div><div><span>Нагрузка</span><strong>{overallRpe || '—'}</strong><small>RPE</small></div></div>
      {feeling}{error && <p className="flux-client-inline-error">{error}</p>}
      <Button className="flux-main-button" size="lg" disabled={saving} onClick={() => { void complete(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Сохранить тренировку</Button>
    </div> : step && plannedSet && position ? <div className="flux-flow-content flux-active-workout">
      <div className="flux-exercise-progress"><span>Упражнение {position.exerciseIndex + 1} из {session.planSnapshot.length}</span><span>Подход {plannedSet.setNumber} из {step.plannedSets.length}</span></div>
      <Progress value={(completeSets / Math.max(totalSets, 1)) * 100} />
      {phase === 'rest' ? <section className="flux-rest-screen">
        <span className="flux-eyebrow">Можно выдохнуть</span><h1>Отдых</h1><p>Следующий: {step.name} · подход {plannedSet.setNumber}</p>
        <CircularWorkoutTimer mode="rest" formattedTime={timerLabel(remaining)} progress={restProgress} visualProgress={restVisualProgress} completed={completionFlash} eyebrow={`Подход ${plannedSet.setNumber} из ${step.plannedSets.length}`} stateLabel="Отдых" />
        <Button className="flux-main-button" size="lg" onClick={finishRest}><SkipForward /> Пропустить отдых</Button>
      </section> : phase === 'next' ? <section className="flux-rest-screen">
        <span className="flux-eyebrow">Следующий шаг</span><h1>{step.name}</h1><p>{plannedTargetLabel(step, plannedSet)} · подход {plannedSet.setNumber} из {step.plannedSets.length}</p>
        <div className="flux-next-exercise"><Dumbbell /><span><small>Готовы продолжить?</small><strong>Подход начнётся только по вашему нажатию.</strong></span></div>
        {step.instructions && <p className="flux-next-instructions">{step.instructions}</p>}
        <Button className="flux-main-button" size="lg" onClick={() => setPhase('ready')}><Play /> Перейти к упражнению</Button>
      </section> : <>
        <div className="flux-active-copy"><span className="flux-eyebrow">{phase === 'active' ? 'Подход выполняется' : phase === 'paused' ? 'Таймер на паузе' : 'План и факт'}</span><h1>{step.name}</h1><p>{step.instructions ?? step.notes ?? 'Выполняйте в комфортном контролируемом темпе.'}</p></div>
        <div className="flux-planned-target"><span>План</span><strong>{plannedTargetLabel(step, plannedSet)}</strong>{plannedSet.restSeconds != null && <small>отдых {plannedSet.restSeconds} сек</small>}</div>
        {step.measurementType === 'duration' ? <>
          <div className={`flux-execution-timer ${phase === 'active' ? 'is-running' : ''}`}>
            <CircularWorkoutTimer
              mode="work"
              formattedTime={timerLabel(durationElapsedSeconds)}
              progress={workTimerProgress(durationElapsedSeconds, plannedSet.targetDurationSeconds)}
              visualProgress={phase === 'active' ? workVisualProgress : undefined}
              paused={phase === 'paused'}
              completed={completionFlash}
              eyebrow={`Подход ${plannedSet.setNumber} из ${step.plannedSets.length}`}
              stateLabel={phase === 'active' ? 'Выполнение' : phase === 'paused' ? 'Таймер на паузе' : 'Таймер подхода'}
              planLabel={`План · ${timerLabel(plannedSet.targetDurationSeconds ?? 0)}`}
              reachedPlan={durationReachedPlan}
            />
            <div className="flux-execution-timer-controls">
              {phase === 'active' ? <Button variant="secondary" onClick={pauseDuration}><Pause /> Пауза</Button> : <Button onClick={startDuration}><Play /> {durationElapsedSeconds > 0 ? 'Продолжить отсчёт' : 'Начать отсчёт'}</Button>}
              {primarySetAction}
            </div>
            {phase !== 'active' && <div className="flux-duration-adjustment"><button type="button" className="flux-duration-adjust-trigger" aria-expanded={durationEditorOpen} aria-controls="flux-duration-manual-adjustment" onClick={() => { if (!durationEditorOpen) setDurationInput(durationManuallyEdited || durationElapsedSeconds > 0 ? durationValue : ''); setDurationEditorOpen((open) => !open); }}>{durationEditorOpen ? 'Готово' : 'Изменить время'}</button>{durationEditorOpen && <div className="flux-workout-fields flux-workout-fields-single flux-duration-actual" id="flux-duration-manual-adjustment"><MinutesSecondsInput label="Фактическая длительность" value={numberOrNull(durationInput)} onChange={(value) => { setDurationInput(value == null ? '' : String(value)); setDurationManuallyEdited(true); setDraftTouched(true); }} /></div>}</div>}
            <button type="button" className="flux-timer-reset" disabled={phase === 'active' || (durationElapsedSeconds === 0 && !durationManuallyEdited)} onClick={resetDuration}>Сбросить таймер</button>
          </div>
        </> : <section className="flux-set-execution-card"><div className="flux-workout-fields">
          {step.measurementType === 'reps' && <label>Повторы<input inputMode="numeric" value={reps} onChange={(event) => { setReps(event.target.value); setDraftTouched(true); }} /></label>}
          {step.measurementType === 'reps' && <label>Вес, кг <small>необязательно</small><input inputMode="decimal" value={weight} onChange={(event) => { setWeight(event.target.value); setDraftTouched(true); }} /></label>}
          {step.measurementType === 'distance' && <label>Метры<input inputMode="numeric" value={distance} onChange={(event) => { setDistance(event.target.value); setDraftTouched(true); }} /></label>}
          {step.measurementType === 'distance' && <MinutesSecondsInput label="Время прохождения" optional value={numberOrNull(durationInput)} onChange={(value) => { setDurationInput(value == null ? '' : String(value)); setDraftTouched(true); }} />}
        </div><div className="flux-workout-flow-actions">{primarySetAction}</div></section>}
        <div className="flux-workout-fields flux-workout-fields-single"><label>Заметка <small>необязательно</small><input value={notes} maxLength={1000} onChange={(event) => { setNotes(event.target.value); setDraftTouched(true); }} /></label></div>
        {(phase === 'active' || phase === 'paused') && feeling}{error && <p className="flux-client-inline-error">{error}</p>}
        {checkpointStatus === 'saving' && <p className="flux-checkpoint-status" role="status">Сохраняем черновик…</p>}
        {checkpointStatus === 'saved' && <p className="flux-checkpoint-status" role="status">Черновик сохранён</p>}
        {checkpointStatus === 'error' && <p className="flux-client-inline-error" role="alert">Черновик не синхронизирован. Проверьте соединение — введённые данные остаются на экране.</p>}
      </>}
    </div> : null}
    {exitOpen && <div className="flux-workout-exit-sheet" role="dialog" aria-modal="true" aria-label="Выйти из тренировки"><div><h2>Закончить на этом месте?</h2><p>Сохранённые подходы уже в аккаунте. Незавершённый подход можно продолжить позже.</p><Button className="flux-main-button" size="lg" onClick={() => setExitOpen(false)}>Продолжить тренировку</Button><Button variant="secondary" size="lg" onClick={leave}>Выйти и продолжить позже</Button><button type="button" className="flux-text-danger" disabled={saving} onClick={requestCompletion}>Завершить тренировку</button></div></div>}
    {completionOpen && <div className="flux-workout-completion-sheet" role="dialog" aria-modal="true" aria-labelledby="flux-completion-title"><div><h2 id="flux-completion-title">{completionMode === 'draft' && hasUnsavedDraft ? 'Сохранить результат подхода?' : completionMode === 'empty' ? 'В тренировке нет сохранённых подходов. Завершить её без результатов?' : 'Не удалось завершить тренировку'}</h2>{completionMode === 'draft' && hasUnsavedDraft ? <><p>Перед завершением выберите, что сделать с несохранённым результатом.</p><section className="flux-completion-draft"><strong>{step?.name} · подход {plannedSet?.setNumber}</strong><span>{draftSummary}</span></section><label className="flux-completion-choice"><input type="checkbox" checked={saveDraftBeforeCompletion} onChange={(event) => setSaveDraftBeforeCompletion(event.target.checked)} />Сохранить этот подход перед завершением</label></> : completionMode === 'empty' ? <p>Ни один подход ещё не сохранён. Введённые данные не будут записаны в историю.</p> : <p>Сохранённые результаты остаются в тренировке. Повторите завершение, когда соединение восстановится.</p>}{error && <p className="flux-client-inline-error" role="alert">{error}</p>}{completionMode === 'draft' && hasUnsavedDraft ? <Button className="flux-main-button" size="lg" disabled={saving || !saveDraftBeforeCompletion} onClick={() => { void confirmCompletion(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Сохранить выбранные и завершить</Button> : completionMode === 'empty' ? <button type="button" className="flux-text-danger flux-completion-empty-finish" disabled={saving} onClick={() => { void confirmCompletion(); }}>Завершить без результатов</button> : <Button className="flux-main-button" size="lg" disabled={saving} onClick={() => { void confirmCompletion(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <RefreshCw />} Повторить завершение</Button>}{completionMode === 'draft' && hasUnsavedDraft && <button type="button" className="flux-text-danger" disabled={saving} onClick={() => { void confirmCompletion(); }}>Завершить без сохранения</button>}<Button variant="secondary" size="lg" disabled={saving} onClick={() => { setCompletionOpen(false); setError(''); }}>Вернуться к тренировке</Button></div></div>}
  </section>, flowHost);
}

export function WorkoutEngineScreen({ userId }: { userId: string | null }) {
  const [plans, setPlans] = useState<WorkoutPlanSummary[]>([]); const [history, setHistory] = useState<WorkoutHistoryItem[]>([]); const [active, setActive] = useState<WorkoutEngineSession | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [openPlanId, setOpenPlanId] = useState<string | null>(null); const [openHistoryId, setOpenHistoryId] = useState<string | null>(null); const [flow, setFlow] = useState<WorkoutEngineSession | null>(null); const [editorPlan, setEditorPlan] = useState<SourceAwareWorkoutPlanV3 | null>(null); const [editorOpen, setEditorOpen] = useState(false);
  const refresh = useCallback(async () => { if (!userId) { setLoading(false); return; } setLoading(true); setError(''); try { const [nextPlans, nextHistory, nextActive] = await Promise.all([loadWorkoutPlans(userId), loadWorkoutHistory(userId), loadActiveWorkoutSessionV3(userId)]); setPlans(nextPlans); setHistory(nextHistory); setActive(nextActive ? engineSession(nextActive) : null); } catch { setError('Не удалось загрузить тренировки. Проверьте соединение и повторите.'); } finally { setLoading(false); } }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const mainPlan = useMemo(() => plans.find((plan) => plan.isActive) ?? null, [plans]);
  if (!userId) return <section className="flux-workout-page-hero"><span>Тренировки</span><strong>Войдите в FLUX</strong><p>Планы и история сохраняются в вашем аккаунте.</p></section>;
  const edit = async (id: string) => { try { const plan = await loadWorkoutPlanV3(userId, id); if (plan.origin === 'trainer_assigned') { setError('План от тренера можно просматривать и выполнять, но не изменять.'); return; } setEditorPlan(plan); setEditorOpen(true); setOpenPlanId(null); } catch { setError('Не удалось открыть редактор плана.'); } };
  const duplicate = async (plan: Pick<WorkoutPlan, 'id' | 'origin' | 'name'>) => { if (plan.origin !== 'personal') return; try { await duplicateMyWorkoutPlan(userId, plan.id); setOpenPlanId(null); await refresh(); } catch { setError('Не удалось дублировать план.'); } };
  const archive = async (plan: Pick<WorkoutPlan, 'id' | 'origin' | 'name'>) => { if (plan.origin !== 'personal' || !window.confirm(`Архивировать «${plan.name}»?`)) return; try { await archiveMyWorkoutPlan(userId, plan.id); setOpenPlanId(null); await refresh(); } catch { setError('Не удалось архивировать план.'); } };
  const remove = async (plan: Pick<WorkoutPlan, 'id' | 'origin' | 'name'>) => { if (plan.origin !== 'personal' || !window.confirm(`Удалить «${plan.name}»? История тренировок сохранится.`)) return; try { await deleteMyWorkoutPlan(userId, plan.id); setOpenPlanId(null); await refresh(); } catch { setError('Нельзя удалить план с активной тренировкой.'); } };
  return <>{loading ? <p className="flux-trainer-empty">Загружаем тренировки…</p> : error ? <div className="flux-trainer-workspace-state"><p>{error}</p><Button size="sm" onClick={() => { void refresh(); }}><RefreshCw /> Повторить</Button></div> : <>{active ? <section className="flux-workout-page-hero"><span>Незавершённая тренировка <i>Продолжить</i></span><strong>{active.title}</strong><p>Подходы уже сохранены на сервере. Можно спокойно вернуться к тому же месту.</p><div><Activity /> {active.sets.length} подходов сохранено</div><Button onClick={() => setFlow(active)}><Play /> Продолжить</Button></section> : mainPlan ? <section className="flux-workout-page-hero"><span>План на сегодня <i>{mainPlan.estimatedDurationMinutes ? `${mainPlan.estimatedDurationMinutes} мин` : 'Ваш темп'}</i></span><strong>{mainPlan.name}</strong><p>{mainPlan.description ?? 'Спокойная тренировка без гонки за результатом.'}</p><div><Dumbbell /> {mainPlan.exerciseCount} упражнений</div><Button onClick={() => setOpenPlanId(mainPlan.id)}><Play /> Начать</Button></section> : <section className="flux-workout-page-hero"><span>Личный план</span><strong>Планов пока нет</strong><p>Создайте первый план — он сохранится в аккаунте и будет готов к тренировке.</p><Button onClick={() => { setEditorPlan(null); setEditorOpen(true); }}><Plus /> Создать план</Button></section>}<section className="flux-exercise-list"><div className="flux-section-heading"><h2>Мои планы</h2><Button size="sm" onClick={() => { setEditorPlan(null); setEditorOpen(true); }}><Plus /> Создать</Button></div>{plans.length ? plans.map((plan, index) => <button type="button" className="flux-workout-list-button" key={plan.id} onClick={() => setOpenPlanId(plan.id)}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{plan.name}</strong><small>{plan.origin === 'trainer_assigned' ? `От тренера${plan.trainerName ? ` · ${plan.trainerName}` : ''} · ` : ''}{plan.exerciseCount} упражнений · {plan.estimatedDurationMinutes ? `${plan.estimatedDurationMinutes} мин` : 'длительность не указана'}{plan.isActive ? '' : ' · архив'}</small></p><ChevronRight /></button>) : <p className="flux-trainer-empty">Личные планы пока не созданы.</p>}</section><section className="flux-workout-history" aria-label="История тренировок"><div className="flux-section-heading"><h2>История</h2><span>{history.length ? `${history.length} всего` : 'Пока пусто'}</span></div>{history.length ? history.map((item) => <button type="button" className="flux-workout-history-button" key={item.id} onClick={() => setOpenHistoryId(item.id)}><span className="flux-rhythm-icon"><Check /></span><p><strong>{item.title}</strong><small>{item.completedAt ? dateLabel(item.completedAt) : dateLabel(item.startedAt)} · {item.completedSets} подходов{item.overallRpe != null ? ` · RPE ${item.overallRpe}` : ''}</small></p><ChevronRight /></button>) : <p>Первая завершённая тренировка появится здесь.</p>}</section></>}<PlanDetailDrawer userId={userId} planId={openPlanId} open={Boolean(openPlanId)} onOpenChange={(open) => { if (!open) setOpenPlanId(null); }} onStart={(session) => { setActive(session); setFlow(session); }} onEdit={(plan) => { void edit(plan.id); }} onDuplicate={(plan) => { void duplicate(plan); }} onArchive={(plan) => { void archive(plan); }} onDelete={(plan) => { void remove(plan); }} /><WorkoutDetailsDrawer userId={userId} sessionId={openHistoryId} open={Boolean(openHistoryId)} onOpenChange={(open) => { if (!open) setOpenHistoryId(null); }} /><PersonalPlanEditorV2 userId={userId} plan={editorPlan} open={editorOpen} onOpenChange={setEditorOpen} onSaved={() => { void refresh(); }} />{flow && <WorkoutEngineFlow userId={userId} initialSession={flow} onClose={() => { setFlow(null); void refresh(); }} onFinished={() => { setFlow(null); void refresh(); }} />}</>;
}
