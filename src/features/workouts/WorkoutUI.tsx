import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, Check, ChevronRight, Clock3, Dumbbell, LoaderCircle, Pause, Play, RefreshCw, SkipForward, X } from 'lucide-react';
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
  savePerformedSet,
  startPersonalWorkout,
  type PerformedSet,
  type WorkoutHistoryItem,
  type WorkoutPlan,
  type WorkoutPlanSummary,
  type WorkoutPlanStep,
  type WorkoutSession,
} from './repository';

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

function PlanDetailDrawer({ userId, planId, open, onOpenChange, onStart }: { userId: string; planId: string | null; open: boolean; onOpenChange: (open: boolean) => void; onStart: (session: WorkoutSession) => void }) {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !planId) return;
    setLoading(true); setError('');
    void loadWorkoutPlan(userId, planId).then(setPlan).catch(() => setError('Не удалось загрузить план.')).finally(() => setLoading(false));
  }, [open, planId, userId]);
  const start = async () => {
    if (!planId || starting) return;
    setStarting(true); setError('');
    try { const session = await startPersonalWorkout(userId, planId); onOpenChange(false); onStart(session); }
    catch { setError('Не удалось начать тренировку. Проверьте соединение и повторите.'); }
    finally { setStarting(false); }
  };
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-workout-plan-drawer"><DrawerHeader className="flux-drawer-header"><button type="button" className="flux-drawer-back" onClick={() => onOpenChange(false)} aria-label="Назад к тренировкам"><ArrowLeft /></button><div><DrawerTitle>{plan?.name ?? 'План тренировки'}</DrawerTitle><DrawerDescription>{plan?.description ?? 'Личный план'}</DrawerDescription></div></DrawerHeader><div className="flux-workout-drawer-body">{loading ? <p className="flux-trainer-empty">Загружаем план…</p> : error && !plan ? <p className="flux-client-inline-error">{error}</p> : plan ? <><section className="flux-workout-hero"><span className="flux-eyebrow">Личный план</span><strong>{plan.name}</strong><p>{plan.estimatedDurationMinutes ? `${plan.estimatedDurationMinutes} мин` : 'Длительность не указана'} · {plan.exercises.length} упражнений</p></section><section className="flux-exercise-list"><div className="flux-section-heading"><h2>Упражнения</h2><span>{plan.level ?? 'Ваш темп'}</span></div>{plan.exercises.map((step, index) => <div key={step.stepId}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{step.name}</strong><small>{step.targetSets} × {targetLabel(step)} · отдых {step.restSeconds} сек</small></p><ChevronRight /></div>)}</section>{error && <p className="flux-client-inline-error">{error}</p>}<Button className="flux-main-button" size="lg" disabled={starting || plan.exercises.length === 0} onClick={() => { void start(); }}>{starting ? <LoaderCircle className="is-spinning" /> : <Play />} {starting ? 'Запускаю…' : 'Начать тренировку'}</Button></> : null}</div></DrawerContent></Drawer>;
}

function WorkoutDetailsDrawer({ userId, sessionId, open, onOpenChange }: { userId: string; sessionId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [session, setSession] = useState<WorkoutSession | null>(null); const [error, setError] = useState('');
  useEffect(() => { if (!open || !sessionId) return; setError(''); setSession(null); void loadWorkoutSession(userId, sessionId).then(setSession).catch(() => setError('Не удалось открыть результат тренировки.')); }, [open, sessionId, userId]);
  return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="flux-drawer flux-workout-plan-drawer"><DrawerHeader className="flux-drawer-header"><button type="button" className="flux-drawer-back" onClick={() => onOpenChange(false)} aria-label="Назад к истории"><ArrowLeft /></button><div><DrawerTitle>{session?.title ?? 'Результат тренировки'}</DrawerTitle><DrawerDescription>{session?.completedAt ? dateLabel(session.completedAt) : 'Загружаем…'}</DrawerDescription></div></DrawerHeader><div className="flux-workout-drawer-body">{error ? <p className="flux-client-inline-error">{error}</p> : !session ? <p className="flux-trainer-empty">Загружаем результат…</p> : <><section className="flux-workout-summary"><div><span>Подходы</span><strong>{session.sets.length}</strong><small>сохранено</small></div><div><span>Время</span><strong>{session.completedAt ? Math.max(1, Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)) : 0}</strong><small>мин</small></div><div><span>Нагрузка</span><strong>{session.overallRpe ?? '—'}</strong><small>RPE</small></div></section><section className="flux-exercise-list"><div className="flux-section-heading"><h2>Фактические подходы</h2><span>{session.sets.length}</span></div>{session.sets.map((item) => <div key={item.id}><span>{item.setNumber}</span><p><strong>{item.exerciseName}</strong><small>{item.reps != null ? `${item.reps} повторений` : item.durationSeconds != null ? `${item.durationSeconds} сек` : item.distanceM != null ? `${item.distanceM} м` : 'Выполнено'}{item.weightKg != null ? ` · ${item.weightKg} кг` : ''}{item.rpe != null ? ` · RPE ${item.rpe}` : ''}</small></p></div>)}</section></>}</div></DrawerContent></Drawer>;
}

function WorkoutEngineFlow({ userId, initialSession, onClose, onFinished }: { userId: string; initialSession: WorkoutSession; onClose: () => void; onFinished: (session: WorkoutSession) => void }) {
  const [session, setSession] = useState(initialSession); const [phase, setPhase] = useState<'ready' | 'running' | 'rest' | 'summary'>('ready');
  const first = sessionNext(initialSession); const [position, setPosition] = useState(first); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(0); const timerEnd = useRef<number | null>(null); const [pausedSeconds, setPausedSeconds] = useState<number | null>(null);
  const step = position ? session.planSnapshot[position.exerciseIndex] : null;
  const existing = step && position ? setFor(session, step.stepId, position.setNumber) : null;
  const [reps, setReps] = useState(''); const [weight, setWeight] = useState(''); const [duration, setDuration] = useState(''); const [distance, setDistance] = useState(''); const [rpe, setRpe] = useState('');
  const clientKey = useRef<string>('');

  useEffect(() => { if (!step || !position) return; const saved = setFor(session, step.stepId, position.setNumber); setReps(saved?.reps?.toString() ?? (step.measurementType === 'reps' ? String(step.targetRepsMin ?? '') : '')); setWeight(saved?.weightKg?.toString() ?? (step.targetWeightKg?.toString() ?? '')); setDuration(saved?.durationSeconds?.toString() ?? (step.measurementType === 'duration' ? String(step.targetDurationSeconds ?? '') : '')); setDistance(saved?.distanceM?.toString() ?? (step.measurementType === 'distance' ? String(step.targetDistanceM ?? '') : '')); setRpe(saved?.rpe?.toString() ?? ''); clientKey.current = saved?.clientSetKey ?? crypto.randomUUID(); setPhase('ready'); setPausedSeconds(null); timerEnd.current = null; setRemaining(0); }, [session.id, step?.stepId, position?.setNumber]);

  const advance = useCallback(() => { const fresh = sessionNext(session); setPosition(fresh); if (!fresh) setPhase('summary'); }, [session]);
  const finishTimer = useCallback(() => { timerEnd.current = null; setPausedSeconds(null); if (phase === 'rest') { advance(); } else { setPhase('ready'); } }, [advance, phase]);
  useEffect(() => {
    if (phase !== 'running' && phase !== 'rest') return;
    const tick = () => { const seconds = Math.max(0, Math.ceil(((timerEnd.current ?? Date.now()) - Date.now()) / 1000)); setRemaining(seconds); if (seconds === 0) finishTimer(); };
    tick(); const id = window.setInterval(tick, 300); window.addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [finishTimer, phase]);
  const beginTimed = () => { if (!step) return; const seconds = pausedSeconds ?? (phase === 'rest' ? step.restSeconds : step.targetDurationSeconds ?? 0); if (!seconds) { setPhase('ready'); return; } timerEnd.current = Date.now() + seconds * 1000; setRemaining(seconds); setPausedSeconds(null); setPhase(phase === 'rest' ? 'rest' : 'running'); };
  const pause = () => { if (timerEnd.current) setPausedSeconds(Math.max(0, Math.ceil((timerEnd.current - Date.now()) / 1000))); timerEnd.current = null; setPhase('ready'); };
  const saveSet = async () => {
    if (!step || !position || saving) return;
    setSaving(true); setError('');
    try {
      const saved = await savePerformedSet(userId, { sessionId: session.id, clientSetKey: clientKey.current, stepId: step.stepId, setNumber: position.setNumber, reps: numberOrNull(reps), weightKg: numberOrNull(weight), durationSeconds: numberOrNull(duration), distanceM: numberOrNull(distance), rpe: numberOrNull(rpe) });
      const next = { ...session, sets: [...session.sets.filter((item) => item.clientSetKey !== saved.clientSetKey), saved] }; setSession(next);
      if (step.restSeconds > 0) { timerEnd.current = Date.now() + step.restSeconds * 1000; setRemaining(step.restSeconds); setPausedSeconds(null); setPhase('rest'); } else { const nextPosition = sessionNext(next); setPosition(nextPosition); setPhase(nextPosition ? 'ready' : 'summary'); }
    } catch { setError('Подход не сохранён. Значения остались на экране — повторите отправку.'); }
    finally { setSaving(false); }
  };
  const complete = async () => { if (saving) return; setSaving(true); setError(''); try { const done = await completeWorkoutSession(userId, session.id, numberOrNull(rpe)); setSession(done); onFinished(done); onClose(); } catch { setError('Не удалось завершить тренировку. Повторите попытку.'); } finally { setSaving(false); } };
  const totalSets = session.planSnapshot.reduce((sum, item) => sum + item.targetSets, 0); const completeSets = session.sets.length;
  return <section className="flux-workout-flow" role="dialog" aria-modal="true" aria-label="Активная тренировка"><header className="flux-flow-header"><Button variant="secondary" size="icon" onClick={onClose} aria-label="Закрыть тренировку"><ArrowLeft /></Button><div><span>{phase === 'rest' ? 'Отдых' : 'Активная тренировка'}</span><strong>{phase === 'summary' ? 'Готово к завершению' : step?.name ?? session.title}</strong></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть"><X /></Button></header>{phase === 'summary' ? <div className="flux-flow-content flux-complete-screen"><span className="flux-complete-icon"><Check /></span><span className="flux-eyebrow">Все подходы сохранены</span><h1>Тренировка готова</h1><p>Проверьте итог и сохраните результат в истории.</p><div className="flux-workout-summary"><div><span>Упражнения</span><strong>{session.planSnapshot.length}</strong><small>в плане</small></div><div><span>Подходы</span><strong>{completeSets}</strong><small>сохранено</small></div><div><span>Нагрузка</span><strong>{rpe || '—'}</strong><small>RPE</small></div></div><label className="flux-workout-field">Как по нагрузке?<select value={rpe} onChange={(event) => setRpe(event.target.value)}><option value="">Не указывать</option>{[1,2,3,4,5,6,7,8,9,10].map((value) => <option value={value} key={value}>{value} / 10</option>)}</select></label>{error && <p className="flux-client-inline-error">{error}</p>}<Button className="flux-main-button" size="lg" disabled={saving} onClick={() => { void complete(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Завершить тренировку</Button></div> : step && position ? <div className="flux-flow-content flux-active-workout"><div className="flux-exercise-progress"><span>Упражнение {position.exerciseIndex + 1} из {session.planSnapshot.length}</span><span>Подход {position.setNumber} из {step.targetSets}</span></div><Progress value={(completeSets / Math.max(totalSets, 1)) * 100} /><div className="flux-active-copy"><span className="flux-eyebrow">{phase === 'rest' ? 'Можно выдохнуть' : `План · ${targetLabel(step)}`}</span><h1>{phase === 'rest' ? 'Отдых' : step.name}</h1><p>{phase === 'rest' ? `Следующий: ${step.name} · подход ${position.setNumber}` : step.instructions ?? step.notes ?? 'Выполняйте в комфортном контролируемом темпе.'}</p></div>{phase === 'rest' ? <><div className="flux-rest-timer"><span><b>{timerLabel(remaining)}</b><small>секунд</small></span></div><Button className="flux-main-button" size="lg" onClick={() => { timerEnd.current = null; advance(); }}><SkipForward /> Пропустить отдых</Button></> : <><div className="flux-workout-fields">{step.measurementType === 'reps' && <label>Повторы<input inputMode="numeric" value={reps} onChange={(event) => setReps(event.target.value)} /></label>}{step.measurementType === 'duration' && <label>Секунды<input inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>}{step.measurementType === 'distance' && <label>Метры<input inputMode="numeric" value={distance} onChange={(event) => setDistance(event.target.value)} /></label>}<label>Вес, кг<input inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><label>RPE<input inputMode="decimal" value={rpe} onChange={(event) => setRpe(event.target.value)} /></label></div>{step.measurementType === 'duration' && <div className="flux-execution-timer"><span>{phase === 'running' ? 'Выполнение' : 'Таймер подхода'}</span><strong>{timerLabel(remaining || (pausedSeconds ?? step.targetDurationSeconds ?? 0))}</strong><small>ориентир · {step.targetDurationSeconds ?? 0} сек</small></div>}{error && <p className="flux-client-inline-error">{error}</p>}<div className="flux-workout-flow-actions">{step.measurementType === 'duration' && (phase === 'running' ? <Button variant="secondary" onClick={pause}><Pause /> Пауза</Button> : <Button variant="secondary" onClick={beginTimed}><Play /> {pausedSeconds != null ? 'Продолжить' : 'Старт таймера'}</Button>)}<Button className="flux-main-button" size="lg" disabled={saving} onClick={() => { void saveSet(); }}>{saving ? <LoaderCircle className="is-spinning" /> : <Check />} Подход выполнен</Button></div></>}</div> : null}</section>;
}

export function WorkoutEngineScreen({ userId }: { userId: string | null }) {
  const [plans, setPlans] = useState<WorkoutPlanSummary[]>([]); const [history, setHistory] = useState<WorkoutHistoryItem[]>([]); const [active, setActive] = useState<WorkoutSession | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [openPlanId, setOpenPlanId] = useState<string | null>(null); const [openHistoryId, setOpenHistoryId] = useState<string | null>(null); const [flow, setFlow] = useState<WorkoutSession | null>(null);
  const refresh = useCallback(async () => { if (!userId) { setLoading(false); return; } setLoading(true); setError(''); try { const [nextPlans, nextHistory, nextActive] = await Promise.all([loadWorkoutPlans(userId), loadWorkoutHistory(userId), loadActiveWorkoutSession(userId)]); setPlans(nextPlans); setHistory(nextHistory); setActive(nextActive); } catch { setError('Не удалось загрузить тренировки. Проверьте соединение и повторите.'); } finally { setLoading(false); } }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const mainPlan = useMemo(() => plans.find((plan) => plan.isActive) ?? plans[0] ?? null, [plans]);
  if (!userId) return <section className="flux-workout-page-hero"><span>Тренировки</span><strong>Войдите в FLUX</strong><p>Планы и история сохраняются в вашем аккаунте.</p></section>;
  return <>{loading ? <p className="flux-trainer-empty">Загружаем тренировки…</p> : error ? <div className="flux-trainer-workspace-state"><p>{error}</p><Button size="sm" onClick={() => { void refresh(); }}><RefreshCw /> Повторить</Button></div> : <>{active ? <section className="flux-workout-page-hero"><span>Незавершённая тренировка <i>Продолжить</i></span><strong>{active.title}</strong><p>Подходы уже сохранены на сервере. Можно спокойно вернуться к тому же месту.</p><div><Activity /> {active.sets.length} подходов сохранено</div><Button onClick={() => setFlow(active)}><Play /> Продолжить</Button></section> : mainPlan ? <section className="flux-workout-page-hero"><span>План на сегодня <i>{mainPlan.estimatedDurationMinutes ? `${mainPlan.estimatedDurationMinutes} мин` : 'Ваш темп'}</i></span><strong>{mainPlan.name}</strong><p>{mainPlan.description ?? 'Спокойная тренировка без гонки за результатом.'}</p><div><Dumbbell /> {mainPlan.exerciseCount} упражнений</div><Button onClick={() => setOpenPlanId(mainPlan.id)}><Play /> Начать</Button></section> : <section className="flux-workout-page-hero"><span>Личный план</span><strong>Планов пока нет</strong><p>Создание плана появится следующим безопасным шагом. Уже существующие планы отобразятся здесь автоматически.</p></section>}<section className="flux-exercise-list"><div className="flux-section-heading"><h2>Мои планы</h2><span>{plans.length}</span></div>{plans.length ? plans.map((plan, index) => <button type="button" className="flux-workout-list-button" key={plan.id} onClick={() => setOpenPlanId(plan.id)}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{plan.name}</strong><small>{plan.exerciseCount} упражнений · {plan.estimatedDurationMinutes ? `${plan.estimatedDurationMinutes} мин` : 'длительность не указана'}</small></p><ChevronRight /></button>) : <p className="flux-trainer-empty">Личные планы пока не созданы.</p>}</section><section className="flux-workout-history" aria-label="История тренировок"><div className="flux-section-heading"><h2>История</h2><span>{history.length ? `${history.length} всего` : 'Пока пусто'}</span></div>{history.length ? history.map((item) => <button type="button" className="flux-workout-history-button" key={item.id} onClick={() => setOpenHistoryId(item.id)}><span className="flux-rhythm-icon"><Check /></span><p><strong>{item.title}</strong><small>{item.completedAt ? dateLabel(item.completedAt) : dateLabel(item.startedAt)} · {item.completedSets} подходов{item.overallRpe != null ? ` · RPE ${item.overallRpe}` : ''}</small></p><ChevronRight /></button>) : <p>Первая завершённая тренировка появится здесь.</p>}</section></>}<PlanDetailDrawer userId={userId} planId={openPlanId} open={Boolean(openPlanId)} onOpenChange={(open) => { if (!open) setOpenPlanId(null); }} onStart={(session) => { setActive(session); setFlow(session); }} /><WorkoutDetailsDrawer userId={userId} sessionId={openHistoryId} open={Boolean(openHistoryId)} onOpenChange={(open) => { if (!open) setOpenHistoryId(null); }} />{flow && <WorkoutEngineFlow userId={userId} initialSession={flow} onClose={() => { setFlow(null); void refresh(); }} onFinished={() => { setFlow(null); void refresh(); }} />}</>;
}
