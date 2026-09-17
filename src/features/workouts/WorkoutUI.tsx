import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, Check, ChevronRight, Dumbbell, LoaderCircle, MoreHorizontal, Pause, Play, Plus, RefreshCw, SkipForward, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Progress } from '@/components/ui/progress';
import {
  completeWorkoutSession,
  loadActiveWorkoutSession,
  loadWorkoutHistory,
  loadWorkoutPlan,
  loadWorkoutPlans,
  loadWorkoutSession,
  archiveMyWorkoutPlan,
  deleteMyWorkoutPlan,
  duplicateMyWorkoutPlan,
  savePerformedSet,
  startPersonalWorkout,
  type PerformedSet,
  type WorkoutHistoryItem,
  type WorkoutPlan,
  type WorkoutPlanSummary,
  type WorkoutPlanStep,
  type WorkoutSession,
} from './repository';
import { PersonalPlanEditor } from './PersonalPlanEditor';

const dateLabel = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(value));
const timerLabel = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value);

function targetLabel(step: WorkoutPlanStep) {
  if (step.measurementType === 'duration') return `${step.targetDurationSeconds ?? 0} сек`;
  if (step.measurementType === 'distance') return `${step.targetDistanceM ?? 0} м`;
  const reps = step.targetRepsMax && step.targetRepsMax !== step.targetRepsMin ? `${step.targetRepsMin}–${step.targetRepsMax}` : step.targetRepsMin;
  return `${reps ?? '—'} повторений${step.targetWeightKg != null ? ` · ${step.targetWeightKg} кг` : ''}`;
}

function sessionNext(session: WorkoutSession) {
  const done = new Set(session.sets.filter((item) => item.isCompleted && item.sessionStepId).map((item) => `${item.sessionStepId}:${item.setNumber}`));
  for (let index = 0; index < session.planSnapshot.length; index += 1) {
    const step = session.planSnapshot[index];
    for (let set = 1; set <= step.targetSets; set += 1) {
      if (!done.has(`${step.stepId}:${set}`)) return { exerciseIndex: index, setNumber: set };
    }
  }
  return null;
}

function setFor(session: WorkoutSession, stepId: string, setNumber: number) {
  return session.sets.find((item) => item.sessionStepId === stepId && item.setNumber === setNumber) ?? null;
}

function PlanDetailDrawer({ userId, planId, open, onOpenChange, onStart, onEdit, onDuplicate, onArchive, onDelete }: { userId: string; planId: string | null; open: boolean; onOpenChange: (open: boolean) => void; onStart: (session: WorkoutSession) => void; onEdit: (plan: WorkoutPlan) => void; onDuplicate: (plan: WorkoutPlan) => void; onArchive: (plan: WorkoutPlan) => void; onDelete: (plan: WorkoutPlan) => void }) {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  useEffect(() => {
    if (!open || !planId) return;
    setLoading(true); setError(''); setActionsOpen(false);
    void loadWorkoutPlan(userId, planId).then(setPlan).catch(() => setError('Не удалось загрузить план.')).finally(() => setLoading(false));
  }, [open, planId, userId]);
  const start = async () => {
    if (!planId || starting) return;
    setStarting(true); setError('');
    try { const session = await startPersonalWorkout(userId, planId); onOpenChange(false); onStart(session); }
    catch { setError('Не удалось начать тренировку. Проверьте соединение и повторите.'); }
    finally { setStarting(false); }
  };
  const chooseAction = (action: (value: WorkoutPlan) => void) => { if (!plan) return; setActionsOpen(false); action(plan); };
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-workout-plan-drawer"><DrawerHeader className="flux-drawer-header"><button type="button" className="flux-drawer-back" onClick={() => onOpenChange(false)} aria-label="Назад к тренировкам"><ArrowLeft /></button><div><DrawerTitle>{plan?.name ?? 'План тренировки'}</DrawerTitle><DrawerDescription>{plan?.description ?? 'Личный план'}</DrawerDescription></div>{plan && <button type="button" className="flux-drawer-back" aria-label="Действия плана" aria-expanded={actionsOpen} onClick={() => setActionsOpen((value) => !value)}><MoreHorizontal /></button>}</DrawerHeader><div className="flux-workout-drawer-body">{plan && actionsOpen && <div className="flux-plan-actions-menu" role="menu"><button type="button" role="menuitem" onClick={() => chooseAction(onEdit)}>Редактировать</button><button type="button" role="menuitem" onClick={() => chooseAction(onDuplicate)}>Создать копию</button>{plan.isActive && <button type="button" role="menuitem" onClick={() => chooseAction(onArchive)}>В архив</button>}<button type="button" className="is-destructive" role="menuitem" onClick={() => chooseAction(onDelete)}>Удалить план</button></div>}{loading ? <p className="flux-trainer-empty">Загружаем план…</p> : error && !plan ? <p className="flux-client-inline-error">{error}</p> : plan ? <><section className="flux-workout-hero"><span className="flux-eyebrow">Личный план</span><strong>{plan.name}</strong><p>{plan.estimatedDurationMinutes ? `${plan.estimatedDurationMinutes} мин` : 'Длительность не указана'} · {plan.exercises.length} упражнений</p></section><section className="flux-exercise-list"><div className="flux-section-heading"><h2>Упражнения</h2><span>{plan.level ?? 'Ваш темп'}</span></div>{plan.exercises.map((step, index) => <div key={step.stepId}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{step.name}</strong><small>{step.targetSets} × {targetLabel(step)} · отдых {step.restSeconds} сек</small></p><ChevronRight /></div>)}</section>{error && <p className="flux-client-inline-error">{error}</p>}<Button className="flux-main-button" size="lg" disabled={starting || plan.exercises.length === 0 || !plan.isActive} onClick={() => { void start(); }}>{starting ? <LoaderCircle className="is-spinning" /> : <Play />} {plan.isActive ? (starting ? 'Запускаю…' : 'Начать тренировку') : 'План в архиве'}</Button></> : null}</div></DrawerContent></Drawer>;
}

function WorkoutDetailsDrawer({ userId, sessionId, open, onOpenChange }: { userId: string; sessionId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [session, setSession] = useState<WorkoutSession | null>(null); const [error, setError] = useState('');
  useEffect(() => { if (!open || !sessionId) return; setError(''); setSession(null); void loadWorkoutSession(userId, sessionId).then(setSession).catch(() => setError('Не удалось открыть результат тренировки.')); }, [open, sessionId, userId]);
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-workout-plan-drawer"><DrawerHeader className="flux-drawer-header"><button type="button" className="flux-drawer-back" onClick={() => onOpenChange(false)} aria-label="Назад к истории"><ArrowLeft /></button><div><DrawerTitle>{session?.title ?? 'Результат тренировки'}</DrawerTitle><DrawerDescription>{session?.completedAt ? dateLabel(session.completedAt) : 'Загружаем…'}</DrawerDescription></div></DrawerHeader><div className="flux-workout-drawer-body">{error ? <p className="flux-client-inline-error">{error}</p> : !session ? <p className="flux-trainer-empty">Загружаем результат…</p> : <><section className="flux-workout-summary"><div><span>Подходы</span><strong>{session.sets.length}</strong><small>сохранено</small></div><div><span>Время</span><strong>{session.completedAt ? Math.max(1, Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)) : 0}</strong><small>мин</small></div><div><span>Нагрузка</span><strong>{session.overallRpe ?? '—'}</strong><small>RPE</small></div></section><section className="flux-exercise-list"><div className="flux-section-heading"><h2>Фактические подходы</h2><span>{session.sets.length}</span></div>{session.sets.map((item) => <div key={item.id}><span>{item.setNumber}</span><p><strong>{item.exerciseName}</strong><small>{item.reps != null ? `${item.reps} повторений` : item.durationSeconds != null ? `${item.durationSeconds} сек` : item.distanceM != null ? `${item.distanceM} м` : 'Выполнено'}{item.weightKg != null ? ` · ${item.weightKg} кг` : ''}{item.rpe != null ? ` · RPE ${item.rpe}` : ''}</small></p></div>)}</section></>}</div></DrawerContent></Drawer>;
}

function WorkoutEngineFlow({ userId, initialSession, onClose, onFinished }: { userId: string; initialSession: WorkoutSession; onClose: () => void; onFinished: (session: WorkoutSession) => void }) {
  type Phase = 'ready' | 'active' | 'paused' | 'rest' | 'next' | 'complete';
  const [session, setSession] = useState(initialSession); const [phase, setPhase] = useState<Phase>('ready');
  const first = sessionNext(initialSession); const [position, setPosition] = useState(first); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [exitOpen, setExitOpen] = useState(false);
  const [remaining, setRemaining] = useState(0); const timerEnd = useRef<number | null>(null); const [pausedSeconds, setPausedSeconds] = useState<number | null>(null); const restNextPhase = useRef<Extract<Phase, 'ready' | 'next'>>('ready');
  const step = position ? session.planSnapshot[position.exerciseIndex] : null;
  const [reps, setReps] = useState(''); const [weight, setWeight] = useState(''); const [duration, setDuration] = useState(''); const [distance, setDistance] = useState(''); const [rpe, setRpe] = useState('');
  const clientKey = useRef<string>('');

  useEffect(() => { if (!step || !position) return; const saved = setFor(session, step.stepId, position.setNumber); setReps(saved?.reps?.toString() ?? (step.measurementType === 'reps' ? String(step.targetRepsMin ?? '') : '')); setWeight(saved?.weightKg?.toString() ?? (step.targetWeightKg?.toString() ?? '')); setDuration(saved?.durationSeconds?.toString() ?? (step.measurementType === 'duration' ? String(step.targetDurationSeconds ?? '') : '')); setDistance(saved?.distanceM?.toString() ?? (step.measurementType === 'distance' ? String(step.targetDistanceM ?? '') : '')); setRpe(saved?.rpe?.toString() ?? ''); clientKey.current = saved?.clientSetKey ?? crypto.randomUUID(); setPausedSeconds(null); setRemaining(0); }, [session.id, step?.stepId, position?.setNumber]);

  const finishTimer = useCallback(() => { timerEnd.current = null; setPausedSeconds(null); setPhase((current) => current === 'rest' ? restNextPhase.current : 'paused'); }, []);
  useEffect(() => {
    if (phase !== 'rest' && !(phase === 'active' && step?.measurementType === 'duration')) return;
    const tick = () => { const seconds = Math.max(0, Math.ceil(((timerEnd.current ?? Date.now()) - Date.now()) / 1000)); setRemaining(seconds); if (seconds === 0) finishTimer(); };
    tick(); const id = window.setInterval(tick, 300); window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [finishTimer, phase, step?.measurementType]);
  const startDuration = () => { if (!step) return; const seconds = pausedSeconds ?? step.targetDurationSeconds ?? 0; if (!seconds) return; timerEnd.current = Date.now() + seconds * 1000; setRemaining(seconds); setPausedSeconds(null); setPhase('active'); };
  const pauseDuration = () => { if (timerEnd.current) setPausedSeconds(Math.max(0, Math.ceil((timerEnd.current - Date.now()) / 1000))); timerEnd.current = null; setPhase('paused'); };
  const finishRest = () => { timerEnd.current = null; setPausedSeconds(null); setPhase(restNextPhase.current); };
  const saveSet = async () => {
    if (!step || !position || saving || (step.measurementType === 'duration' && phase === 'ready')) return;
    setSaving(true); setError('');
    try {
      const saved = await savePerformedSet(userId, { sessionId: session.id, clientSetKey: clientKey.current, stepId: step.stepId, setNumber: position.setNumber, reps: numberOrNull(reps), weightKg: numberOrNull(weight), durationSeconds: step.measurementType === 'duration' ? Number(step.targetDurationSeconds ?? 0) : numberOrNull(duration), distanceM: numberOrNull(distance), rpe: numberOrNull(rpe) });
      const next = { ...session, sets: [...session.sets.filter((item) => item.clientSetKey !== saved.clientSetKey), saved] }; const nextPosition = sessionNext(next); setSession(next); setPosition(nextPosition);
      if (!nextPosition) { setPhase('complete'); return; }
      const isNewExercise = nextPosition.exerciseIndex !== position.exerciseIndex;
      restNextPhase.current = isNewExercise ? 'next' : 'ready';
      if (step.restSeconds > 0) { timerEnd.current = Date.now() + step.restSeconds * 1000; setRemaining(step.restSeconds); setPausedSeconds(null); setPhase('rest'); } else setPhase(isNewExercise ? 'next' : 'ready');
    } catch { setError('Подход не сохранён. Значения остались на экране — повторите отправку.'); }
    finally { setSaving(false); }
  };
  const complete = async () => { if (saving) return; setSaving(true); setError(''); try { const done = await completeWorkoutSession(userId, session.id, numberOrNull(rpe)); setSession(done); onFinished(done); onClose(); } catch { setError('Не удалось завершить тренировку. Повторите попытку.'); } finally { setSaving(false); } };
  const totalSets = session.planSnapshot.reduce((sum, item) => sum + item.targetSets, 0); const completeSets = session.sets.length;
  const phaseLabel = phase === 'rest' ? 'Отдых' : phase === 'next' ? 'Следующее упражнение' : phase === 'complete' ? 'Результат' : 'Активная тренировка';
  const rpeChoices = [{ label: 'Легко', value: '3' }, { label: 'Нормально', value: '6' }, { label: 'Тяжело', value: '8' }, { label: 'На пределе', value: '10' }];
  const feeling = <fieldset className="flux-feeling"><legend>Насколько тяжело было?</legend><small>Необязательно</small><div>{rpeChoices.map((item) => <button type="button" key={item.value} className={rpe === item.value ? 'is-active' : ''} aria-pressed={rpe === item.value} onClick={() => setRpe(item.value)}>{item.label}</button>)}</div></fieldset>;
  const leave = () => { timerEnd.current = null; onClose(); };
  return <section className="flux-workout-flow" role="dialog" aria-modal="true" aria-label="Активная тренировка"><header className="flux-flow-header"><Button variant="secondary" size="icon" onClick={leave} aria-label="Вернуться к тренировкам"><ArrowLeft /></Button><div><span>{phaseLabel}</span><strong>{phase === 'complete' ? 'Тренировка готова' : step?.name ?? session.title}</strong></div><Button variant="ghost" size="icon" onClick={() => setExitOpen(true)} aria-label="Закрыть"><X /></Button></header>{phase === 'complete' ? <div className="flux-flow-content flux-complete-screen"><span className="flux-complete-icon"><Check /></span><span className="flux-eyebrow">Все подходы сохранены</span><h1>Тренировка завершена</h1><p>Результаты уже собраны. Когда будете готовы — сохраните их в истории.</p><div className="flux-workout-summary"><div><span>Упражнения</span><strong>{session.planSnapshot.length}</strong><small>в плане</small></div><div><span>Подходы</span><strong>{completeSets}</strong><small>сохранено</small></div><div><span>Нагрузка</span><strong>{rpe || '—'}</strong><small>RPE</small></div></div>{feeling}{error && <p className="flux-client-inline-error">{error}</p>}<Button className="flux-main-button" size="lg" disabled={saving} onClick={() => { void complete(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Сохранить тренировку</Button></div> : step && position ? <div className="flux-flow-content flux-active-workout"><div className="flux-exercise-progress"><span>Упражнение {position.exerciseIndex + 1} из {session.planSnapshot.length}</span><span>Подход {position.setNumber} из {step.targetSets}</span></div><Progress value={(completeSets / Math.max(totalSets, 1)) * 100} />{phase === 'rest' ? <section className="flux-rest-screen"><span className="flux-eyebrow">Можно выдохнуть</span><h1>Отдых</h1><p>Следующий: {step.name} · подход {position.setNumber}</p><div className="flux-rest-timer"><span><b>{timerLabel(remaining)}</b><small>секунд</small></span></div><Button className="flux-main-button" size="lg" onClick={finishRest}><SkipForward /> Пропустить отдых</Button></section> : phase === 'next' ? <section className="flux-rest-screen"><span className="flux-eyebrow">Следующий шаг</span><h1>{step.name}</h1><p>{targetLabel(step)} · подход {position.setNumber} из {step.targetSets}</p><div className="flux-next-exercise"><Dumbbell /><span><small>Готовы продолжить?</small><strong>Подход начнётся только по вашему нажатию.</strong></span></div><Button className="flux-main-button" size="lg" onClick={() => setPhase('ready')}><Play /> Перейти к упражнению</Button></section> : <><div className="flux-active-copy"><span className="flux-eyebrow">{phase === 'active' ? 'Подход выполняется' : phase === 'paused' ? 'Таймер на паузе' : `План · ${targetLabel(step)}`}</span><h1>{step.name}</h1><p>{step.instructions ?? step.notes ?? 'Выполняйте в комфортном контролируемом темпе.'}</p></div>{step.measurementType === 'duration' ? <><div className={`flux-execution-timer ${phase === 'active' ? 'is-running' : ''}`}><span>{phase === 'active' ? 'Выполнение' : phase === 'paused' ? 'Можно продолжить или завершить' : 'Таймер подхода'}</span><strong className="flux-morph-number">{timerLabel(remaining || pausedSeconds || step.targetDurationSeconds || 0)}</strong><small>план · {step.targetDurationSeconds ?? 0} сек</small></div></> : <div className="flux-workout-fields">{step.measurementType === 'reps' && <label>Повторы<input inputMode="numeric" value={reps} onChange={(event) => setReps(event.target.value)} /></label>}{step.measurementType === 'reps' && <label>Вес, кг <small>необязательно</small><input inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>}{step.measurementType === 'distance' && <label>Метры<input inputMode="numeric" value={distance} onChange={(event) => setDistance(event.target.value)} /></label>}{step.measurementType === 'distance' && <label>Время, сек <small>необязательно</small><input inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>}</div>}{(phase === 'active' || phase === 'paused') && feeling}{error && <p className="flux-client-inline-error">{error}</p>}<div className="flux-workout-flow-actions">{step.measurementType === 'duration' && (phase === 'active' ? <Button variant="secondary" onClick={pauseDuration}><Pause /> Пауза</Button> : phase === 'ready' || phase === 'paused' ? <Button variant="secondary" onClick={startDuration}><Play /> {pausedSeconds != null ? 'Продолжить отсчёт' : 'Начать отсчёт'}</Button> : null)}{step.measurementType !== 'duration' && phase === 'ready' ? <Button className="flux-main-button" size="lg" onClick={() => setPhase('active')}><Play /> Начать подход</Button> : <Button className="flux-main-button" size="lg" disabled={saving || (step.measurementType === 'duration' && phase === 'ready')} onClick={() => { void saveSet(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Завершить подход</Button>}</div></>}</div> : null}{exitOpen && <div className="flux-workout-exit-sheet" role="dialog" aria-modal="true" aria-label="Выйти из тренировки"><div><h2>Закончить на этом месте?</h2><p>Сохранённые подходы уже в аккаунте. Незавершённый подход можно продолжить позже.</p><Button className="flux-main-button" size="lg" onClick={() => setExitOpen(false)}>Продолжить тренировку</Button><Button variant="secondary" size="lg" onClick={leave}>Выйти и продолжить позже</Button><button type="button" className="flux-text-danger" onClick={() => { setExitOpen(false); void complete(); }}>Завершить тренировку</button></div></div>}</section>;
}

export function WorkoutEngineScreen({ userId }: { userId: string | null }) {
  const [plans, setPlans] = useState<WorkoutPlanSummary[]>([]); const [history, setHistory] = useState<WorkoutHistoryItem[]>([]); const [active, setActive] = useState<WorkoutSession | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [openPlanId, setOpenPlanId] = useState<string | null>(null); const [openHistoryId, setOpenHistoryId] = useState<string | null>(null); const [flow, setFlow] = useState<WorkoutSession | null>(null); const [editorPlan, setEditorPlan] = useState<WorkoutPlan | null>(null); const [editorOpen, setEditorOpen] = useState(false);
  const refresh = useCallback(async () => { if (!userId) { setLoading(false); return; } setLoading(true); setError(''); try { const [nextPlans, nextHistory, nextActive] = await Promise.all([loadWorkoutPlans(userId), loadWorkoutHistory(userId), loadActiveWorkoutSession(userId)]); setPlans(nextPlans); setHistory(nextHistory); setActive(nextActive); } catch { setError('Не удалось загрузить тренировки. Проверьте соединение и повторите.'); } finally { setLoading(false); } }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const mainPlan = useMemo(() => plans.find((plan) => plan.isActive) ?? null, [plans]);
  if (!userId) return <section className="flux-workout-page-hero"><span>Тренировки</span><strong>Войдите в FLUX</strong><p>Планы и история сохраняются в вашем аккаунте.</p></section>;
  const edit = async (id: string) => { try { setEditorPlan(await loadWorkoutPlan(userId, id)); setEditorOpen(true); setOpenPlanId(null); } catch { setError('Не удалось открыть редактор плана.'); } };
  const duplicate = async (plan: WorkoutPlan) => { try { await duplicateMyWorkoutPlan(userId, plan.id); setOpenPlanId(null); await refresh(); } catch { setError('Не удалось дублировать план.'); } };
  const archive = async (plan: WorkoutPlan) => { if (!window.confirm(`Архивировать «${plan.name}»?`)) return; try { await archiveMyWorkoutPlan(userId, plan.id); setOpenPlanId(null); await refresh(); } catch { setError('Не удалось архивировать план.'); } };
  const remove = async (plan: WorkoutPlan) => { if (!window.confirm(`Удалить «${plan.name}»? История тренировок сохранится.`)) return; try { await deleteMyWorkoutPlan(userId, plan.id); setOpenPlanId(null); await refresh(); } catch { setError('Нельзя удалить план с активной тренировкой.'); } };
  return <>{loading ? <p className="flux-trainer-empty">Загружаем тренировки…</p> : error ? <div className="flux-trainer-workspace-state"><p>{error}</p><Button size="sm" onClick={() => { void refresh(); }}><RefreshCw /> Повторить</Button></div> : <>{active ? <section className="flux-workout-page-hero"><span>Незавершённая тренировка <i>Продолжить</i></span><strong>{active.title}</strong><p>Подходы уже сохранены на сервере. Можно спокойно вернуться к тому же месту.</p><div><Activity /> {active.sets.length} подходов сохранено</div><Button onClick={() => setFlow(active)}><Play /> Продолжить</Button></section> : mainPlan ? <section className="flux-workout-page-hero"><span>План на сегодня <i>{mainPlan.estimatedDurationMinutes ? `${mainPlan.estimatedDurationMinutes} мин` : 'Ваш темп'}</i></span><strong>{mainPlan.name}</strong><p>{mainPlan.description ?? 'Спокойная тренировка без гонки за результатом.'}</p><div><Dumbbell /> {mainPlan.exerciseCount} упражнений</div><Button onClick={() => setOpenPlanId(mainPlan.id)}><Play /> Начать</Button></section> : <section className="flux-workout-page-hero"><span>Личный план</span><strong>Планов пока нет</strong><p>Создайте первый план — он сохранится в аккаунте и будет готов к тренировке.</p><Button onClick={() => { setEditorPlan(null); setEditorOpen(true); }}><Plus /> Создать план</Button></section>}<section className="flux-exercise-list"><div className="flux-section-heading"><h2>Мои планы</h2><Button size="sm" onClick={() => { setEditorPlan(null); setEditorOpen(true); }}><Plus /> Создать</Button></div>{plans.length ? plans.map((plan, index) => <button type="button" className="flux-workout-list-button" key={plan.id} onClick={() => setOpenPlanId(plan.id)}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{plan.name}</strong><small>{plan.exerciseCount} упражнений · {plan.estimatedDurationMinutes ? `${plan.estimatedDurationMinutes} мин` : 'длительность не указана'}{plan.isActive ? '' : ' · архив'}</small></p><ChevronRight /></button>) : <p className="flux-trainer-empty">Личные планы пока не созданы.</p>}</section><section className="flux-workout-history" aria-label="История тренировок"><div className="flux-section-heading"><h2>История</h2><span>{history.length ? `${history.length} всего` : 'Пока пусто'}</span></div>{history.length ? history.map((item) => <button type="button" className="flux-workout-history-button" key={item.id} onClick={() => setOpenHistoryId(item.id)}><span className="flux-rhythm-icon"><Check /></span><p><strong>{item.title}</strong><small>{item.completedAt ? dateLabel(item.completedAt) : dateLabel(item.startedAt)} · {item.completedSets} подходов{item.overallRpe != null ? ` · RPE ${item.overallRpe}` : ''}</small></p><ChevronRight /></button>) : <p>Первая завершённая тренировка появится здесь.</p>}</section></>}<PlanDetailDrawer userId={userId} planId={openPlanId} open={Boolean(openPlanId)} onOpenChange={(open) => { if (!open) setOpenPlanId(null); }} onStart={(session) => { setActive(session); setFlow(session); }} onEdit={(plan) => { void edit(plan.id); }} onDuplicate={(plan) => { void duplicate(plan); }} onArchive={(plan) => { void archive(plan); }} onDelete={(plan) => { void remove(plan); }} /><WorkoutDetailsDrawer userId={userId} sessionId={openHistoryId} open={Boolean(openHistoryId)} onOpenChange={(open) => { if (!open) setOpenHistoryId(null); }} /><PersonalPlanEditor userId={userId} plan={editorPlan} open={editorOpen} onOpenChange={setEditorOpen} onSaved={() => { void refresh(); }} />{flow && <WorkoutEngineFlow userId={userId} initialSession={flow} onClose={() => { setFlow(null); void refresh(); }} onFinished={() => { setFlow(null); void refresh(); }} />}</>;
}
