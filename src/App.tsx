import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Banana,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  Coffee,
  Dumbbell,
  House,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Sprout,
  Trash2,
  Utensils,
  Wheat,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  PhonePasswordAuthGate,
  isTurnstileConfigured,
  type PhoneAuthMode,
  type PhoneAuthSubmission,
} from './features/auth/PhonePasswordAuthGate';
import {
  getCurrentAccount,
  registerWithLogin,
  signInWithLogin,
  type FluxAccount,
} from './features/auth/phonePasswordAuth';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Toaster, toast } from '@/components/ui/toast';
import { fallbackProducts } from './features/nutrition/catalog';
import {
  addRemoteMealEntry,
  bootstrapNutrition,
  claimGuestDiaryForNewUser,
  countGuestDiaryEntries,
  deleteRemoteMealEntry,
  guestNutritionScope,
  isSameNutritionScope,
  loadLocalEntriesForToday,
  nutritionScopeForUser,
  persistLocalEntriesForToday,
  persistNewLocalEntry,
  queueRemoteMealDeletion,
  removeLocalEntryFromStorage,
  type NutritionMode,
  type NutritionStorageScope,
} from './features/nutrition/repository';
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabase';
import {
  MEAL_KINDS,
  type MealEntry,
  type MealKind,
  type NutritionTotals,
  type Product,
} from './features/nutrition/types';

type Tab = 'today' | 'food' | 'workouts' | 'progress';

const macroTargets = { protein: 110, fat: 70, carbs: 230 };

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function currentMeal(): MealKind {
  const hour = new Date().getHours();
  if (hour < 11) return 'Завтрак';
  if (hour < 16) return 'Обед';
  if (hour < 19) return 'Перекус';
  return 'Ужин';
}

function mealInSentence(meal: MealKind) {
  return meal.toLocaleLowerCase('ru');
}

function ProductIcon({ type }: { type: Product['icon'] }) {
  const Icon = type === 'wheat' ? Wheat : type === 'banana' ? Banana : type === 'coffee' ? Coffee : Utensils;
  return <Icon aria-hidden="true" />;
}

function MorphNumber({ value, className = '' }: { value: string | number; className?: string }) {
  const text = String(value);
  const previousValue = useRef(text);
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    if (previousValue.current === text) return;
    setPrevious(previousValue.current);
    previousValue.current = text;
    const timer = window.setTimeout(() => setPrevious(null), 340);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <span className={`flux-morph-number ${className}`}>
      {previous && <span className="flux-morph-old" aria-hidden="true">{previous}</span>}
      <span key={text} className="flux-morph-new">{text}</span>
    </span>
  );
}

function QuickAddDrawer({
  open,
  onOpenChange,
  onAdd,
  products,
  entries,
  initialProduct,
  initialMeal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: Product, amount: number, meal: MealKind) => Promise<void>;
  products: Product[];
  entries: MealEntry[];
  initialProduct: Product | null;
  initialMeal: MealKind;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [amount, setAmount] = useState<number | ''>(180);
  const [meal, setMeal] = useState<MealKind>(initialMeal);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMeal(initialMeal);
    setSelected(initialProduct);
    setAmount(initialProduct?.amount ?? 180);
  }, [initialMeal, initialProduct, open]);

  const recentIds = [...entries]
    .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
    .map((entry) => entry.productId)
    .filter((id): id is string => Boolean(id));
  const filtered = products
    .filter((product) => `${product.name} ${product.brand}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => {
      if (query.trim()) return a.name.localeCompare(b.name, 'ru');
      const aIndex = recentIds.indexOf(a.id);
      const bIndex = recentIds.indexOf(b.id);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  const repeatEntry = [...entries].sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))[0];
  const repeatProduct = repeatEntry
    ? products.find((product) => product.id === repeatEntry.productId) ?? repeatEntry
    : null;

  function choose(product: Product) {
    setSelected(product);
    setAmount(product.amount);
  }

  function close() {
    onOpenChange(false);
    window.setTimeout(() => {
      setSelected(null);
      setQuery('');
      setIsAdding(false);
    }, 250);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => {
        setSelected(null);
        setQuery('');
        setIsAdding(false);
      }, 250);
    }
  }

  async function submit(product: Product, quantity: number) {
    if (isAdding || quantity <= 0) return;
    setIsAdding(true);
    try {
      await onAdd(product, quantity, meal);
      close();
    } finally {
      setIsAdding(false);
    }
  }

  const numericAmount = typeof amount === 'number' ? amount : 0;
  const scale = selected ? numericAmount / selected.amount : 1;
  const amountStep = selected?.unit === 'шт' ? 1 : 10;
  const amountMinimum = selected?.unit === 'шт' ? 1 : 10;
  const portionPresets = selected
    ? [...new Set(selected.unit === 'шт' ? [1, 2, 3] : selected.unit === 'мл' ? [200, 250, selected.amount] : [100, 150, selected.amount])]
    : [];

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer">
        <DrawerHeader className="flux-drawer-header">
          <DrawerTitle>{selected ? selected.name : 'Добавить еду'}</DrawerTitle>
          <DrawerDescription>{selected ? selected.brand : `Сегодня · ${meal}`}</DrawerDescription>
        </DrawerHeader>
        <div className="flux-meal-picker" role="group" aria-label="Приём пищи">
          {MEAL_KINDS.map((kind) => (
            <button key={kind} type="button" className={meal === kind ? 'is-active' : ''} onClick={() => setMeal(kind)}>
              {kind}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="flux-portion-view">
            <div className="flux-portion-caption"><span>Количество</span><span>Обычно: {selected.amount} {selected.unit}</span></div>
            <div className="flux-portion-stepper">
              <Button variant="secondary" size="icon-lg" onClick={() => setAmount((value) => Math.max(amountMinimum, (Number(value) || selected.amount) - amountStep))} aria-label="Уменьшить количество"><Minus /></Button>
              <label>
                <input
                  className="flux-portion-input"
                  type="number"
                  inputMode="decimal"
                  min={amountMinimum}
                  step={amountStep}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value === '' ? '' : Math.max(0, Number(event.target.value)))}
                  onBlur={() => { if (!numericAmount) setAmount(selected.amount); }}
                  aria-label={`Количество, ${selected.unit}`}
                />
                <span>{selected.unit}</span>
              </label>
              <Button variant="secondary" size="icon-lg" onClick={() => setAmount((value) => (Number(value) || selected.amount) + amountStep)} aria-label="Увеличить количество"><Plus /></Button>
            </div>
            <div className="flux-portion-presets">
              {portionPresets.map((preset) => (
                <button type="button" key={preset} className={numericAmount === preset ? 'is-active' : ''} onClick={() => setAmount(preset)}>
                  {preset === selected.amount ? 'Обычно · ' : ''}{preset} {selected.unit}
                </button>
              ))}
            </div>
            <div className="flux-nutrient-grid">
              <div><span>Калории</span><strong><MorphNumber value={Math.round(selected.kcal * scale)} /></strong><small>ккал</small></div>
              <div><span>Белки</span><strong><MorphNumber value={Math.round(selected.protein * scale)} /></strong><small>г</small></div>
              <div><span>Жиры</span><strong><MorphNumber value={Math.round(selected.fat * scale)} /></strong><small>г</small></div>
              <div><span>Углеводы</span><strong><MorphNumber value={Math.round(selected.carbs * scale)} /></strong><small>г</small></div>
            </div>
            <Button className="flux-main-button" size="lg" disabled={isAdding || numericAmount <= 0} onClick={() => submit(selected, numericAmount)}>
              <span>{isAdding ? 'Сохраняю…' : `Добавить в ${mealInSentence(meal)}`}</span><strong>{Math.round(selected.kcal * scale)} ккал</strong>
            </Button>
            <button type="button" className="flux-text-button" onClick={() => setSelected(null)}><ArrowLeft /> Назад к продуктам</button>
          </div>
        ) : (
          <div className="flux-quick-add-view">
            <label className="flux-search-field">
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти продукт или бренд" aria-label="Найти продукт или бренд" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X /></button>}
            </label>
            {!query && repeatEntry && repeatProduct && (
              <section className="flux-usual-meal">
                <div><span>Добавляли недавно</span><strong>Повторить в один тап</strong></div>
                <div className="flux-usual-row">
                  <span className="flux-food-icon"><ProductIcon type={repeatProduct.icon} /></span>
                  <span><strong>{repeatProduct.name}</strong><small>{repeatEntry.amount} {repeatEntry.unit} · {repeatEntry.kcal} ккал</small></span>
                </div>
                <Button variant="secondary" disabled={isAdding} onClick={() => submit(repeatProduct, repeatEntry.amount)}><Plus /> Добавить снова</Button>
              </section>
            )}
            <section className="flux-product-results">
              <div className="flux-section-heading"><h2>{query ? 'Результаты поиска' : recentIds.length ? 'Недавние и частые' : 'Популярные продукты'}</h2></div>
              {filtered.map((product) => (
                <button key={product.id} type="button" className="flux-product-row" onClick={() => choose(product)}>
                  <span className="flux-food-icon"><ProductIcon type={product.icon} /></span>
                  <span><strong>{product.name}</strong><small>{product.brand} · обычно {product.amount} {product.unit}</small></span>
                  <span><strong>{product.kcal}</strong><small>ккал</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
              {filtered.length === 0 && <div className="flux-empty"><strong>Ничего не нашли</strong><span>Проверьте название — создание своего продукта добавим следующим шагом.</span></div>}
            </section>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

type WorkoutPhase = 'overview' | 'ready' | 'running' | 'rest' | 'complete';

const workoutExercises = [
  { name: 'Приседания', reps: 12, hint: 'Колени направлены вслед за стопами. Двигайтесь в комфортной амплитуде.' },
  { name: 'Отжимания от опоры', reps: 10, hint: 'Держите корпус ровно и выберите удобную высоту опоры.' },
  { name: 'Ягодичный мост', reps: 15, hint: 'Поднимайте таз плавно, без сильного прогиба в пояснице.' },
];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function WorkoutFlow({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<WorkoutPhase>('overview');
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [setNumber, setSetNumber] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState(30);
  const [completedSets, setCompletedSets] = useState(0);
  const exercise = workoutExercises[exerciseIndex];

  function startReady() {
    setExerciseIndex(0);
    setSetNumber(1);
    setCompletedSets(0);
    setElapsed(0);
    setRest(30);
    setPhase('ready');
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
      .filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function advance(startImmediately: boolean) {
    if (setNumber < 3) {
      setSetNumber((value) => value + 1);
    } else if (exerciseIndex < workoutExercises.length - 1) {
      setSetNumber(1);
      setExerciseIndex((value) => value + 1);
    } else {
      setPhase('complete');
      return;
    }
    setElapsed(0);
    setPhase(startImmediately ? 'running' : 'ready');
  }

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'rest') return;
    if (rest <= 0) {
      advance(false);
      return;
    }
    const timer = window.setTimeout(() => setRest(rest - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, rest]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [phase]);

  const nextLabel = setNumber < 3
    ? `${exercise.name} · подход ${setNumber + 1}`
    : workoutExercises[exerciseIndex + 1]?.name ?? 'Завершение тренировки';

  function completeSet() {
    setCompletedSets((value) => value + 1);
    setRest(30);
    setPhase('rest');
  }

  return (
    <section ref={dialogRef} className="flux-workout-flow" role="dialog" aria-modal="true" aria-label="Активная тренировка" onKeyDown={handleDialogKeyDown}>
      <header className="flux-flow-header">
        <Button variant="secondary" size="icon" onClick={phase === 'overview' ? onClose : () => setPhase('overview')} aria-label="Назад"><ArrowLeft /></Button>
        <div><span>{phase === 'rest' ? 'Всё тело' : 'План на сегодня'}</span><strong>{phase === 'overview' ? 'Тренировка' : phase === 'complete' ? 'Готово' : exercise.name}</strong></div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть тренировку"><X /></Button>
      </header>

      {phase === 'overview' && (
        <div className="flux-flow-content">
          <div className="flux-page-heading"><span className="flux-eyebrow">Мягкий старт</span><h1>Всё тело</h1><p>Можно закончить раньше — тренировка всё равно засчитается.</p></div>
          <section className="flux-workout-hero"><span className="flux-big-activity"><Activity /></span><div><span>Сегодня</span><strong>Движение без спешки</strong><p>28 минут · 6 упражнений · без инвентаря</p></div></section>
          <section className="flux-exercise-list"><div className="flux-section-heading"><h2>План</h2><span>3 круга</span></div>{workoutExercises.map((item, index) => <div key={item.name}><span>0{index + 1}</span><p><strong>{item.name}</strong><small>3 × {item.reps}</small></p><ChevronRight /></div>)}</section>
          <Button className="flux-main-button" size="lg" onClick={startReady}><Play /> Начать тренировку</Button>
        </div>
      )}

      {(phase === 'ready' || phase === 'running') && (
        <div className="flux-flow-content flux-active-workout">
          <div className="flux-exercise-progress"><span>Упражнение {exerciseIndex + 1} из {workoutExercises.length}</span><span>Подход {setNumber} из 3</span></div>
          <Progress value={((exerciseIndex * 3 + setNumber - 1) / (workoutExercises.length * 3)) * 100} />
          <div className="flux-motion-field"><Activity /><button type="button">Как выполнять</button></div>
          <div className="flux-active-copy"><span className="flux-eyebrow">Подход {setNumber} из 3</span><h1>{exercise.name}</h1><p>{phase === 'ready' ? 'Нажмите «Старт», когда будете готовы. Таймер начнёт отсчёт выполнения.' : `${exercise.hint} Когда закончите, отметьте подход.`}</p></div>
          <div className={`flux-execution-timer ${phase === 'running' ? 'is-running' : ''}`} role="timer" aria-label={`Время подхода ${formatTime(elapsed)}`}>
            <span>{phase === 'running' ? 'Подход выполняется' : `Подход ${setNumber} готов к старту`}</span>
            <MorphNumber value={formatTime(elapsed)} />
            <small>Ориентир · {exercise.reps} повторений</small>
          </div>
          <div className="flux-set-dots" aria-label={`Подход ${setNumber} из 3`}>{[1, 2, 3].map((number) => <i key={number} className={number < setNumber ? 'is-done' : number === setNumber ? 'is-current' : ''} />)}</div>
          <Button className="flux-main-button" size="lg" onClick={() => phase === 'ready' ? setPhase('running') : completeSet()}>{phase === 'ready' ? <><Play /> Старт</> : <><Check /> Подход выполнен</>}</Button>
          {phase === 'running' && <button className="flux-text-button" type="button" onClick={() => setPhase('ready')}><Pause /> Пауза</button>}
        </div>
      )}

      {phase === 'rest' && (
        <div className="flux-flow-content flux-rest-screen">
          <span className="flux-eyebrow">Подход готов</span><h1>Можно выдохнуть</h1><p>Отдых — часть тренировки, а не пауза в ней.</p>
          <div className="flux-rest-timer" style={{ '--rest-progress': `${(rest / 30) * 360}deg` } as CSSProperties}><span><MorphNumber value={rest} /><small>секунд</small></span></div>
          <div className="flux-next-exercise"><ArrowRight /><span><small>Следующий шаг</small><strong>{nextLabel}</strong></span></div>
          <Button className="flux-main-button" size="lg" onClick={() => advance(true)}><Play /> {exerciseIndex === workoutExercises.length - 1 && setNumber === 3 ? 'Завершить тренировку' : setNumber < 3 ? `Начать подход ${setNumber + 1}` : 'Начать следующее упражнение'}</Button>
          <button type="button" className="flux-text-button" onClick={() => setRest((value) => value + 15)}>+ 15 секунд</button>
        </div>
      )}

      {phase === 'complete' && (
        <div className="flux-flow-content flux-complete-screen">
          <span className="flux-complete-icon"><Sprout /></span><span className="flux-eyebrow">Тренировка завершена</span><h1>На сегодня достаточно</h1><p>Вы нашли время подвигаться — именно из таких дней и складывается прогресс.</p>
          <div className="flux-workout-summary"><div><span>Время</span><strong>{Math.max(1, Math.round(completedSets * 2.5))}</strong><small>мин</small></div><div><span>Упражнения</span><strong>{exerciseIndex + 1}</strong><small>из {workoutExercises.length}</small></div><div><span>Подходы</span><strong>{completedSets}</strong><small>всего</small></div></div>
          <div className="flux-feeling"><span>Как вам нагрузка?</span><div><button type="button">Легко</button><button type="button" className="is-active">В самый раз</button><button type="button">Тяжело</button></div></div>
          <Button className="flux-main-button" size="lg" onClick={onClose}><Check /> Готово</Button>
        </div>
      )}
    </section>
  );
}

function TodayScreen({
  firstName,
  totals,
  target,
  products,
  onSelectProduct,
  onOpenFood,
  onWorkout,
}: {
  firstName?: string;
  totals: NutritionTotals;
  target: number;
  products: Product[];
  onSelectProduct: (product: Product) => void;
  onOpenFood: () => void;
  onWorkout: () => void;
}) {
  const remaining = Math.max(0, target - totals.kcal);
  const progress = Math.min(100, Math.round((totals.kcal / target) * 100));
  const macros = [
    { label: 'Белки', value: totals.protein, target: macroTargets.protein },
    { label: 'Жиры', value: totals.fat, target: macroTargets.fat },
    { label: 'Углеводы', value: totals.carbs, target: macroTargets.carbs },
  ];

  return (
    <>
      <section className="flux-greeting"><p>Доброе утро{firstName ? `, ${firstName}` : ''}</p><h1>Сегодня достаточно<br />просто продолжить.</h1></section>
      <section className="flux-balance-card" aria-label="Баланс питания на сегодня">
        <div className="flux-balance-heading"><div><span className="flux-eyebrow">Баланс на сегодня</span><strong><MorphNumber value={remaining.toLocaleString('ru-RU')} /> <small>ккал осталось</small></strong></div><div className="flux-ring" style={{ '--flux-progress': `${progress * 3.6}deg` } as CSSProperties}><span>{progress}%</span></div></div>
        <div className="flux-macro-grid">{macros.map((macro) => <div key={macro.label}><span>{macro.label}</span><strong>{macro.value} / {macro.target} г</strong><Progress value={(macro.value / macro.target) * 100} aria-label={`${macro.label}: ${macro.value} из ${macro.target} грамм`} /></div>)}</div>
      </section>
      <section className="flux-section"><div className="flux-section-heading"><h2>Быстро добавить</h2><button type="button" onClick={onOpenFood}>Все продукты</button></div><div className="flux-quick-grid">{products.slice(0, 2).map((product) => <button type="button" className="flux-quick-food" key={product.id} onClick={() => onSelectProduct(product)}><span className={`flux-food-icon ${product.icon === 'curd' ? 'flux-food-icon-warm' : ''}`}><ProductIcon type={product.icon} /></span><span><strong>{product.name.replace(' на молоке', '')}</strong><small>{product.amount} {product.unit}</small></span><Plus /></button>)}</div></section>
      <section className="flux-workout-card"><span className="flux-workout-icon"><Activity /></span><div><span className="flux-eyebrow">Тренировка дня</span><h2>Всё тело · 28 мин</h2><p>6 упражнений, спокойный темп</p></div><Button size="icon" aria-label="Открыть тренировку" onClick={onWorkout}><ArrowRight /></Button></section>
    </>
  );
}

function FoodScreen({
  entries,
  target,
  mode,
  isConnecting,
  isAuthenticated,
  canConnect,
  onConnect,
  onAdd,
  onRemove,
}: {
  entries: MealEntry[];
  target: number;
  mode: NutritionMode;
  isConnecting: boolean;
  isAuthenticated: boolean;
  canConnect: boolean;
  onConnect: () => void;
  onAdd: (meal?: MealKind) => void;
  onRemove: (entry: MealEntry) => void;
}) {
  const total = entries.reduce((sum, entry) => sum + entry.kcal, 0);
  const isSynced = mode === 'supabase' && isAuthenticated;
  return (
    <>
      <div className="flux-page-heading flux-page-heading-row"><div><span className="flux-eyebrow">Сегодня</span><h1>Питание</h1></div><Button size="icon-lg" onClick={() => onAdd()} aria-label="Добавить продукт"><Plus /></Button></div>
      <button
        className={`flux-sync-status ${isSynced ? 'is-cloud' : ''} ${canConnect && !isSynced ? 'is-actionable' : ''}`}
        type="button"
        disabled={isConnecting || isSynced || !canConnect}
        onClick={onConnect}
      >
        {isConnecting
          ? <><LoaderCircle className="is-spinning" /> Подключаю данные…</>
          : isSynced
            ? <><Cloud /> Синхронизировано с Supabase</>
            : canConnect
              ? <><Cloud /> {isAuthenticated ? 'Повторить синхронизацию' : 'Войти или создать профиль'}</>
              : 'Сохраняется на этом устройстве'}
      </button>
      <button className="flux-food-search" type="button" onClick={() => onAdd()}><Search /><span>Что вы съели?</span></button>
      <div className="flux-calorie-line"><span>{total.toLocaleString('ru-RU')} из {target.toLocaleString('ru-RU')} ккал</span><strong>{Math.round((total / target) * 100)}%</strong></div><Progress value={(total / target) * 100} />
      <section className="flux-meal-list">
        <div className="flux-section-heading"><h2>Приёмы пищи</h2></div>
        {entries.length === 0 && <div className="flux-diary-empty"><Sprout /><strong>Дневник пока пуст</strong><span>Добавьте первый продукт — баланс пересчитается сразу.</span></div>}
        {MEAL_KINDS.map((meal) => {
          const mealEntries = entries.filter((entry) => entry.meal === meal);
          const mealCalories = mealEntries.reduce((sum, entry) => sum + entry.kcal, 0);
          return (
            <article className="flux-meal-group" key={meal}>
              <header>
                <div><strong>{meal}</strong><span>{mealCalories ? `${mealCalories} ккал` : 'Пока пусто'}</span></div>
                <button type="button" onClick={() => onAdd(meal)} aria-label={`Добавить в ${mealInSentence(meal)}`}><Plus /></button>
              </header>
              {mealEntries.map((entry) => (
                <div className="flux-meal-row" key={entry.entryId}>
                  <span>{entry.time}</span>
                  <p><strong>{entry.name}</strong><small>{entry.amount} {entry.unit} · {entry.brand}</small></p>
                  <b>{entry.kcal}</b>
                  <button type="button" className="flux-remove-entry" onClick={() => onRemove(entry)} aria-label={`Удалить ${entry.name}`}><Trash2 /></button>
                </div>
              ))}
            </article>
          );
        })}
      </section>
      <Button className="flux-main-button" size="lg" onClick={() => onAdd()}><Plus /> Добавить продукт</Button>
    </>
  );
}

function WorkoutsScreen({ onStart }: { onStart: () => void }) {
  return (
    <>
      <div className="flux-page-heading flux-page-heading-row"><div><span className="flux-eyebrow">План на сегодня</span><h1>Всё тело</h1></div><span className="flux-soft-pill">28 мин</span></div>
      <section className="flux-workout-page-hero"><span>Без гонки за результатом</span><strong>Просто сделаем<br />следующий подход.</strong><div><Play /> 6 упражнений · 3 круга</div></section>
      <section className="flux-exercise-list"><div className="flux-section-heading"><h2>Упражнения</h2><span>Начальный</span></div>{workoutExercises.map((exercise, index) => <div key={exercise.name}><span>0{index + 1}</span><p><strong>{exercise.name}</strong><small>{exercise.reps} повторений</small></p><ChevronRight /></div>)}</section>
      <Button className="flux-main-button" size="lg" onClick={onStart}><Play /> Начать тренировку</Button>
    </>
  );
}

function ProgressScreen() {
  const week = [42, 68, 55, 82, 71, 20, 12];
  return (
    <>
      <div className="flux-page-heading flux-page-heading-row"><div><span className="flux-eyebrow">Без давления</span><h1>Прогресс</h1></div><span className="flux-soft-pill">4 недели</span></div>
      <section className="flux-streak-card"><span><Sprout /></span><div><small>Ваш ритм</small><strong>12 дней в движении</strong><p>Не идеально. Зато стабильно.</p></div></section>
      <section className="flux-week-card"><div className="flux-section-heading"><h2>Эта неделя</h2></div><div className="flux-week-bars">{week.map((height, index) => <div key={index}><i className={index === 4 ? 'is-today' : ''} style={{ height: `${height}%` }} /><span>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index]}</span></div>)}</div></section>
      <div className="flux-stat-grid"><div><span>Тренировки</span><strong>3</strong><small>из 3 на неделе</small></div><div><span>Средний баланс</span><strong>−240</strong><small>ккал в день</small></div></div>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [diary, setDiary] = useState<{
    scope: NutritionStorageScope;
    entries: MealEntry[];
    hydrated: boolean;
  }>({ scope: guestNutritionScope, entries: [], hydrated: false });
  const entries = diary.entries;
  const nutritionScopeRef = useRef<NutritionStorageScope>(guestNutritionScope);
  const nutritionGeneration = useRef(0);
  const nutritionHydratedRef = useRef(false);
  const activeDay = useRef(localDayKey());
  const [catalog, setCatalog] = useState<Product[]>(fallbackProducts);
  const [nutritionMode, setNutritionMode] = useState<NutritionMode>('local');
  const [nutritionConnecting, setNutritionConnecting] = useState(true);
  const [account, setAccount] = useState<FluxAccount | null>(null);
  const [authGateOpen, setAuthGateOpen] = useState(false);
  const [authGateMode, setAuthGateMode] = useState<PhoneAuthMode>('signup');
  const [guestDiaryEntryCount, setGuestDiaryEntryCount] = useState(() => countGuestDiaryEntries());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddProduct, setQuickAddProduct] = useState<Product | null>(null);
  const [quickAddMeal, setQuickAddMeal] = useState<MealKind>(() => currentMeal());
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const calorieTarget = 2000;

  function setEntries(update: MealEntry[] | ((current: MealEntry[]) => MealEntry[])) {
    setDiary((current) => {
      if (!current.hydrated) return current;
      const nextEntries = typeof update === 'function' ? update(current.entries) : update;
      return { ...current, entries: nextEntries };
    });
  }

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const hydrateSession = async (sessionAccount: FluxAccount | null) => {
      const generation = ++nutritionGeneration.current;
      const scope = sessionAccount ? nutritionScopeForUser(sessionAccount.id) : guestNutritionScope;
      const localEntries = loadLocalEntriesForToday(scope);
      nutritionScopeRef.current = scope;
      nutritionHydratedRef.current = true;
      setAccount(sessionAccount);
      setNutritionMode('local');
      setNutritionConnecting(true);
      setQuickAddOpen(false);
      setDiary({ scope, entries: localEntries, hydrated: true });

      if (sessionAccount) {
        const resolvedAccount = await getCurrentAccount().catch(() => null);
        if (!active || generation !== nutritionGeneration.current) return;
        if (!resolvedAccount || resolvedAccount.id !== sessionAccount.id) {
          await hydrateSession(null);
          return;
        }
        setAccount(resolvedAccount);
      }

      const result = await bootstrapNutrition(scope, localEntries);
      if (!active || generation !== nutritionGeneration.current || !isSameNutritionScope(scope, nutritionScopeRef.current)) return;
      setNutritionMode(result.mode);
      if (result.products.length) setCatalog(result.products);
      setDiary({ scope, entries: result.entries, hydrated: true });
      setNutritionConnecting(false);
    };

    void getSupabaseClient()
      .then((client) => {
        if (!active) return;
        if (!client) {
          void hydrateSession(null);
          return;
        }

        const { data } = client.auth.onAuthStateChange((event, session) => {
          const user = session?.user && !session.user.is_anonymous ? session.user : null;
          const nextScope = user ? nutritionScopeForUser(user.id) : guestNutritionScope;
          if (event !== 'INITIAL_SESSION'
            && nutritionHydratedRef.current
            && isSameNutritionScope(nextScope, nutritionScopeRef.current)) return;

          const sessionAccount: FluxAccount | null = user ? {
            id: user.id,
            displayName: String(user.user_metadata?.display_name ?? '').trim(),
            login: user.email?.endsWith('@flux.local') ? user.email.slice(0, -('@flux.local'.length)) : '',
            phone: '',
          } : null;

          window.setTimeout(() => {
            if (active) void hydrateSession(sessionAccount);
          }, 0);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => { if (active) void hydrateSession(null); });

    return () => {
      active = false;
      unsubscribe?.();
      nutritionGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(async () => {
      const nextDay = localDayKey();
      if (nextDay === activeDay.current) return;
      activeDay.current = nextDay;
      setQuickAddOpen(false);
      setNutritionConnecting(true);
      const scope = nutritionScopeRef.current;
      const generation = nutritionGeneration.current;
      const localEntries = loadLocalEntriesForToday(scope);
      setDiary((current) => isSameNutritionScope(current.scope, scope)
        ? { scope, entries: localEntries, hydrated: true }
        : current);
      const result = await bootstrapNutrition(scope, localEntries);
      if (!active || activeDay.current !== nextDay || generation !== nutritionGeneration.current || !isSameNutritionScope(scope, nutritionScopeRef.current)) return;
      setNutritionMode(result.mode);
      if (result.products.length) setCatalog(result.products);
      setDiary({ scope, entries: result.entries, hydrated: true });
      setNutritionConnecting(false);
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (diary.hydrated) persistLocalEntriesForToday(diary.scope, diary.entries);
  }, [diary]);

  const totals = useMemo(() => entries.reduce((sum, entry) => ({ kcal: sum.kcal + entry.kcal, protein: sum.protein + entry.protein, fat: sum.fat + entry.fat, carbs: sum.carbs + entry.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 }), [entries]);

  const canConnectNutrition = isSupabaseConfigured && isTurnstileConfigured;
  const firstName = account?.displayName.split(/\s+/)[0];
  const avatarLabel = account?.displayName
    ? account.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU')
    : '+';

  async function connectNutrition() {
    const scope = diary.scope;
    const localEntries = diary.entries;
    const generation = nutritionGeneration.current;
    setNutritionConnecting(true);
    try {
      const result = await bootstrapNutrition(scope, localEntries);
      if (generation !== nutritionGeneration.current || !isSameNutritionScope(scope, nutritionScopeRef.current)) {
        throw new Error('Профиль изменился во время синхронизации');
      }
      setNutritionMode(result.mode);
      if (result.products.length) setCatalog(result.products);
      setDiary({ scope, entries: result.entries, hydrated: true });
      if (result.mode !== 'supabase') throw new Error(result.message ?? 'Не удалось подключить синхронизацию');
    } finally {
      if (generation === nutritionGeneration.current) setNutritionConnecting(false);
    }
  }

  function openAuth(mode: PhoneAuthMode = 'signup') {
    setAuthGateMode(mode);
    setAuthGateOpen(true);
  }

  function openSync() {
    if (!account) {
      openAuth('signup');
      return;
    }
    void connectNutrition().then(() => {
      toast.add({ title: 'Синхронизация подключена', description: 'Дневник теперь сохраняется в Supabase.', type: 'success' });
    }).catch(() => {
      toast.add({ title: 'Не удалось подключиться', description: 'Проверьте интернет и попробуйте ещё раз.', type: 'error' });
    });
  }

  async function authenticate(submission: PhoneAuthSubmission) {
    const nextAccount = submission.mode === 'signup'
      ? await registerWithLogin({
        displayName: submission.displayName,
        login: submission.login,
        phone: submission.phone,
        password: submission.password,
        captchaToken: submission.captchaToken,
      })
      : await signInWithLogin({
        login: submission.login,
        password: submission.password,
        captchaToken: submission.captchaToken,
      });

    let importedGuestEntries = 0;
    if (submission.mode === 'signup' && submission.importGuestDiary) {
      try {
        importedGuestEntries = await claimGuestDiaryForNewUser(nextAccount.id);
        setGuestDiaryEntryCount(countGuestDiaryEntries());
      } catch {
        toast.add({
          title: 'Профиль создан',
          description: 'Гостевой дневник остался на устройстве: перенос можно будет повторить.',
          type: 'info',
        });
      }
    }

    const scope = nutritionScopeForUser(nextAccount.id);
    const generation = ++nutritionGeneration.current;
    const scopedEntries = loadLocalEntriesForToday(scope);
    nutritionScopeRef.current = scope;
    setAccount(nextAccount);
    setNutritionMode('local');
    setNutritionConnecting(true);
    setDiary({ scope, entries: scopedEntries, hydrated: true });

    try {
      const result = await bootstrapNutrition(scope, scopedEntries);
      if (generation !== nutritionGeneration.current || !isSameNutritionScope(scope, nutritionScopeRef.current)) {
        return nextAccount;
      }
      setNutritionMode(result.mode);
      if (result.products.length) setCatalog(result.products);
      setDiary({ scope, entries: result.entries, hydrated: true });
      if (result.mode !== 'supabase') throw new Error(result.message ?? 'Не удалось подключить синхронизацию');
    } catch {
      toast.add({ title: 'Профиль готов', description: 'Данные пока остаются на устройстве — синхронизацию повторим позже.', type: 'info' });
      return nextAccount;
    } finally {
      if (generation === nutritionGeneration.current) setNutritionConnecting(false);
    }

    toast.add({
      title: submission.mode === 'signup' ? 'Профиль создан' : 'С возвращением',
      description: importedGuestEntries > 0
        ? `Гостевой дневник перенесён: ${importedGuestEntries}.`
        : `${nextAccount.displayName || 'Ваш профиль'} · данные синхронизированы.`,
      type: 'success',
    });
    return nextAccount;
  }

  function openFood(meal: MealKind = currentMeal(), product: Product | null = null) {
    if (nutritionConnecting) {
      toast.add({ title: 'Подключаю дневник', description: 'Ещё мгновение — и можно добавлять продукты.', type: 'info' });
      return;
    }
    setQuickAddMeal(meal);
    setQuickAddProduct(product);
    setQuickAddOpen(true);
  }

  async function addProduct(product: Product, amount = product.amount, meal: MealKind = currentMeal()) {
    const scope = diary.scope;
    const scale = amount / product.amount;
    const eatenAt = new Date().toISOString();
    const entry: MealEntry = {
      ...product,
      amount,
      kcal: Math.round(product.kcal * scale),
      protein: Math.round(product.protein * scale),
      fat: Math.round(product.fat * scale),
      carbs: Math.round(product.carbs * scale),
      entryId: crypto.randomUUID(),
      mealId: crypto.randomUUID(),
      productId: product.id,
      meal,
      time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(eatenAt)),
      eatenAt,
    };

    if (!persistNewLocalEntry(scope, entry)) {
      toast.add({ title: 'Не удалось сохранить запись', description: 'Локальное хранилище недоступно. Попробуйте ещё раз.', type: 'error' });
      return;
    }
    if (scope.kind === 'guest') setGuestDiaryEntryCount(countGuestDiaryEntries());
    setEntries((current) => [...current, entry]);

    if (nutritionMode === 'supabase') {
      try {
        await addRemoteMealEntry(scope, entry);
      } catch {
        setNutritionMode('local');
        toast.add({ title: 'Сохранили на устройстве', description: 'Supabase временно недоступен — запись не потеряется.', type: 'info' });
      }
    }

    toast.add({ title: `Добавлено в ${mealInSentence(meal)}`, description: `${product.name} · ${amount} ${product.unit} · ${entry.kcal} ккал`, type: 'success' });
  }

  async function removeEntry(entry: MealEntry) {
    if (nutritionConnecting) {
      toast.add({ title: 'Подключаю дневник', description: 'Дождитесь завершения синхронизации.', type: 'info' });
      return;
    }

    const scope = diary.scope;
    const shouldQueueRemoteDeletion = isSupabaseConfigured && scope.kind === 'user';
    if (shouldQueueRemoteDeletion && !queueRemoteMealDeletion(scope, entry)) {
      toast.add({ title: 'Не удалось удалить запись', description: 'Локальное хранилище недоступно. Попробуйте ещё раз.', type: 'error' });
      return;
    }

    const removedFromStorage = removeLocalEntryFromStorage(scope, entry.entryId);
    if (!shouldQueueRemoteDeletion && !removedFromStorage) {
      toast.add({ title: 'Не удалось удалить запись', description: 'Локальное хранилище недоступно. Попробуйте ещё раз.', type: 'error' });
      return;
    }

    setEntries((current) => current.filter((candidate) => candidate.entryId !== entry.entryId));
    if (scope.kind === 'guest') setGuestDiaryEntryCount(countGuestDiaryEntries());
    if (nutritionMode === 'supabase') {
      try {
        await deleteRemoteMealEntry(scope, entry);
      } catch {
        setNutritionMode('local');
        toast.add({ title: 'Удалено на устройстве', description: 'Синхронизируем удаление, когда Supabase снова станет доступен.', type: 'info' });
        return;
      }
    }
    toast.add({ title: 'Запись удалена', description: `${entry.name} · ${entry.kcal} ккал`, type: 'info' });
  }

  const navItems: { id: Tab; label: string; icon: typeof House }[] = [
    { id: 'today', label: 'Сегодня', icon: House },
    { id: 'food', label: 'Питание', icon: Utensils },
    { id: 'workouts', label: 'Тренировки', icon: Dumbbell },
    { id: 'progress', label: 'Прогресс', icon: ChartNoAxesColumnIncreasing },
  ];

  return (
    <Toaster>
      <main className="flux-stage">
        <section className="flux-app-shell" aria-label="Приложение FLUX">
          <div className="flux-base-app" aria-hidden={workoutOpen || undefined} inert={workoutOpen || undefined}>
            <header className="flux-topbar"><button className="flux-brand" type="button" onClick={() => setTab('today')} aria-label="FLUX — главная"><img className="flux-brand-lockup" src={`${import.meta.env.BASE_URL}brand/flux-lockup.png`} alt="" draggable="false" /></button><Button className="flux-avatar" variant="secondary" size="icon" onClick={() => account ? toast.add({ title: account.displayName || 'Ваш профиль', description: 'Настройки профиля добавим следующим шагом.', type: 'info' }) : openAuth('signup')} aria-label={account ? 'Открыть профиль' : 'Войти или зарегистрироваться'}>{avatarLabel}</Button></header>
            <div className="flux-content" id="top">
              {tab === 'today' && <TodayScreen firstName={firstName} totals={totals} target={calorieTarget} products={catalog} onSelectProduct={(product) => openFood(currentMeal(), product)} onOpenFood={() => openFood()} onWorkout={() => setWorkoutOpen(true)} />}
              {tab === 'food' && <FoodScreen entries={entries} target={calorieTarget} mode={nutritionMode} isConnecting={nutritionConnecting} isAuthenticated={Boolean(account)} canConnect={canConnectNutrition} onConnect={openSync} onAdd={(meal) => openFood(meal ?? currentMeal())} onRemove={removeEntry} />}
              {tab === 'workouts' && <WorkoutsScreen onStart={() => setWorkoutOpen(true)} />}
              {tab === 'progress' && <ProgressScreen />}
            </div>
            <nav className="flux-bottom-nav" aria-label="Основная навигация">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon /><span>{item.label}</span></button>; })}</nav>
          </div>
          {workoutOpen && <WorkoutFlow onClose={() => setWorkoutOpen(false)} />}
        </section>
      </main>
      <QuickAddDrawer
        open={quickAddOpen}
        onOpenChange={(nextOpen) => { setQuickAddOpen(nextOpen); if (!nextOpen) setQuickAddProduct(null); }}
        onAdd={addProduct}
        products={catalog}
        entries={entries}
        initialProduct={quickAddProduct}
        initialMeal={quickAddMeal}
      />
      <PhonePasswordAuthGate
        guestDiaryEntryCount={guestDiaryEntryCount}
        initialMode={authGateMode}
        open={authGateOpen}
        onOpenChange={setAuthGateOpen}
        onAuthenticated={authenticate}
      />
    </Toaster>
  );
}
