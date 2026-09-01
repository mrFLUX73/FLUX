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
  Coffee,
  Dumbbell,
  House,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Sprout,
  Utensils,
  Wheat,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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

type Tab = 'today' | 'food' | 'workouts' | 'progress';
type MealKind = 'Завтрак' | 'Обед' | 'Перекус' | 'Ужин';

type Product = {
  id: string;
  name: string;
  brand: string;
  amount: number;
  unit: 'г' | 'шт';
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  icon: 'wheat' | 'curd' | 'banana' | 'coffee';
};

type MealEntry = Product & {
  entryId: string;
  meal: MealKind;
  time: string;
};

const products: Product[] = [
  { id: 'oatmeal', name: 'Овсянка на молоке', brand: 'Домашнее блюдо', amount: 180, unit: 'г', kcal: 190, protein: 7, fat: 5, carbs: 29, icon: 'wheat' },
  { id: 'curd', name: 'Творог 5%', brand: 'Простоквашино', amount: 180, unit: 'г', kcal: 218, protein: 30, fat: 9, carbs: 5, icon: 'curd' },
  { id: 'banana', name: 'Банан', brand: 'Обычный', amount: 1, unit: 'шт', kcal: 105, protein: 1, fat: 0, carbs: 27, icon: 'banana' },
  { id: 'coffee', name: 'Капучино', brand: 'Без сахара', amount: 250, unit: 'г', kcal: 120, protein: 6, fat: 6, carbs: 10, icon: 'coffee' },
];

const initialEntries: MealEntry[] = [
  { ...products[0], entryId: 'breakfast-oat', name: 'Овсянка, банан, кофе', amount: 1, unit: 'шт', kcal: 410, protein: 18, fat: 11, carbs: 60, meal: 'Завтрак', time: '08:40' },
  { ...products[0], entryId: 'lunch', name: 'Курица, рис, овощи', amount: 1, unit: 'шт', kcal: 620, protein: 46, fat: 18, carbs: 71, meal: 'Обед', time: '13:15' },
  { ...products[1], entryId: 'snack', name: 'Творог, ягоды', amount: 1, unit: 'шт', kcal: 350, protein: 30, fat: 9, carbs: 25, meal: 'Перекус', time: '16:30' },
];

const macroTargets = { protein: 110, fat: 70, carbs: 230 };

function FluxMark({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 48 48" fill="none">
      <path d="M23.7 21.2C17.2 20.6 11 17.1 7.5 11.5C5.9 8.9 7.2 5.4 10.1 4.4C16.9 2 24.4 4.3 29 9.8C32.7 14.2 33.6 19.9 31.4 24.4" fill="currentColor" />
      <path d="M26.9 23.6C30.7 18.2 36.8 14.5 43.4 14.2C46.4 14 48.8 16.8 48 19.8C46.1 26.8 40.1 31.9 33 33C27.3 33.8 21.9 31.7 19.1 27.7" fill="currentColor" transform="translate(-1 -1)" />
      <path d="M22.8 27.2C25.6 33.2 25.8 40.5 22.5 46.3C21 48.9 17.3 49.5 15.2 47.3C10.2 42.1 8.7 34.3 11.4 27.7C13.6 22.4 18.1 18.8 23 18.6" fill="currentColor" transform="translate(1 -1)" />
      <circle cx="24" cy="24" r="5.5" fill="var(--flux-bg)" />
    </svg>
  );
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: Product, amount: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [amount, setAmount] = useState(180);

  const filtered = products.filter((product) => `${product.name} ${product.brand}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));

  function choose(product: Product) {
    setSelected(product);
    setAmount(product.amount);
  }

  function close() {
    onOpenChange(false);
    window.setTimeout(() => {
      setSelected(null);
      setQuery('');
    }, 250);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => {
        setSelected(null);
        setQuery('');
      }, 250);
    }
  }

  const scale = selected ? amount / selected.amount : 1;

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer">
        <DrawerHeader className="flux-drawer-header">
          <DrawerTitle>{selected ? selected.name : 'Добавить еду'}</DrawerTitle>
          <DrawerDescription>{selected ? selected.brand : 'Сегодня · Завтрак'}</DrawerDescription>
        </DrawerHeader>
        {selected ? (
          <div className="flux-portion-view">
            <div className="flux-portion-caption"><span>Количество</span><span>Обычно: {selected.amount} {selected.unit}</span></div>
            <div className="flux-portion-stepper">
              <Button variant="secondary" size="icon-lg" onClick={() => setAmount((value) => Math.max(selected.unit === 'шт' ? 1 : 10, value - (selected.unit === 'шт' ? 1 : 10)))} aria-label="Уменьшить количество"><Minus /></Button>
              <div><MorphNumber value={amount} /><span>{selected.unit}</span></div>
              <Button variant="secondary" size="icon-lg" onClick={() => setAmount((value) => value + (selected.unit === 'шт' ? 1 : 10))} aria-label="Увеличить количество"><Plus /></Button>
            </div>
            <div className="flux-portion-presets">
              {(selected.unit === 'шт' ? [1, 2, 3] : [100, 150, selected.amount]).map((preset, index) => (
                <button type="button" key={`${preset}-${index}`} className={amount === preset ? 'is-active' : ''} onClick={() => setAmount(preset)}>
                  {index === 2 ? 'Обычно · ' : ''}{preset} {selected.unit}
                </button>
              ))}
            </div>
            <div className="flux-nutrient-grid">
              <div><span>Калории</span><strong>{Math.round(selected.kcal * scale)}</strong><small>ккал</small></div>
              <div><span>Белки</span><strong>{Math.round(selected.protein * scale)}</strong><small>г</small></div>
              <div><span>Жиры</span><strong>{Math.round(selected.fat * scale)}</strong><small>г</small></div>
              <div><span>Углеводы</span><strong>{Math.round(selected.carbs * scale)}</strong><small>г</small></div>
            </div>
            <Button className="flux-main-button" size="lg" onClick={() => { onAdd(selected, amount); close(); }}>
              <span>Добавить к завтраку</span><strong>{Math.round(selected.kcal * scale)} ккал</strong>
            </Button>
            <button type="button" className="flux-text-button" onClick={() => setSelected(null)}><ArrowLeft /> Назад к продуктам</button>
          </div>
        ) : (
          <div className="flux-quick-add-view">
            <label className="flux-search-field">
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти продукт или блюдо" aria-label="Найти продукт или блюдо" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X /></button>}
            </label>
            {!query && (
              <section className="flux-usual-meal">
                <div><span>Обычно в это время</span><strong>Ваш привычный завтрак</strong></div>
                <div className="flux-usual-row">
                  <span className="flux-food-stack"><i><Wheat /></i><i><Banana /></i><i><Coffee /></i></span>
                  <span><strong>Овсянка, банан, кофе</strong><small>Обычная порция · 410 ккал</small></span>
                </div>
                <Button variant="secondary" onClick={() => {
                  const usual = { ...products[0], id: 'usual-breakfast', name: 'Овсянка, банан, кофе', amount: 1, unit: 'шт' as const, kcal: 410, protein: 18, fat: 11, carbs: 60 };
                  onAdd(usual, 1);
                  close();
                }}><Plus /> Добавить всё</Button>
              </section>
            )}
            <section className="flux-product-results">
              <div className="flux-section-heading"><h2>{query ? 'Результаты поиска' : 'Часто добавляете'}</h2></div>
              {filtered.map((product) => (
                <button key={product.id} type="button" className="flux-product-row" onClick={() => choose(product)}>
                  <span className="flux-food-icon"><ProductIcon type={product.icon} /></span>
                  <span><strong>{product.name}</strong><small>{product.brand} · обычно {product.amount} {product.unit}</small></span>
                  <span><strong>{product.kcal}</strong><small>ккал</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
              {filtered.length === 0 && <p className="flux-empty">Ничего не нашли. Попробуйте другое название.</p>}
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
  totals,
  target,
  onAdd,
  onOpenFood,
  onWorkout,
}: {
  totals: { kcal: number; protein: number; fat: number; carbs: number };
  target: number;
  onAdd: (product: Product) => void;
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
      <section className="flux-greeting"><p>Доброе утро, Алексей</p><h1>Сегодня достаточно<br />просто продолжить.</h1></section>
      <section className="flux-balance-card" aria-label="Баланс питания на сегодня">
        <div className="flux-balance-heading"><div><span className="flux-eyebrow">Баланс на сегодня</span><strong><MorphNumber value={remaining.toLocaleString('ru-RU')} /> <small>ккал осталось</small></strong></div><div className="flux-ring" style={{ '--flux-progress': `${progress * 3.6}deg` } as CSSProperties}><span>{progress}%</span></div></div>
        <div className="flux-macro-grid">{macros.map((macro) => <div key={macro.label}><span>{macro.label}</span><strong>{macro.value} / {macro.target} г</strong><Progress value={(macro.value / macro.target) * 100} aria-label={`${macro.label}: ${macro.value} из ${macro.target} грамм`} /></div>)}</div>
      </section>
      <section className="flux-section"><div className="flux-section-heading"><h2>Быстро добавить</h2><button type="button" onClick={onOpenFood}>Все продукты</button></div><div className="flux-quick-grid">{products.slice(0, 2).map((product) => <button type="button" className="flux-quick-food" key={product.id} onClick={() => onAdd(product)}><span className={`flux-food-icon ${product.id === 'curd' ? 'flux-food-icon-warm' : ''}`}><ProductIcon type={product.icon} /></span><span><strong>{product.id === 'oatmeal' ? 'Овсянка' : 'Творог'}</strong><small>{product.amount} {product.unit}</small></span><Plus /></button>)}</div></section>
      <section className="flux-workout-card"><span className="flux-workout-icon"><Activity /></span><div><span className="flux-eyebrow">Тренировка дня</span><h2>Всё тело · 28 мин</h2><p>6 упражнений, спокойный темп</p></div><Button size="icon" aria-label="Открыть тренировку" onClick={onWorkout}><ArrowRight /></Button></section>
    </>
  );
}

function FoodScreen({ entries, target, onAdd }: { entries: MealEntry[]; target: number; onAdd: () => void }) {
  const total = entries.reduce((sum, entry) => sum + entry.kcal, 0);
  return (
    <>
      <div className="flux-page-heading flux-page-heading-row"><div><span className="flux-eyebrow">Сегодня</span><h1>Питание</h1></div><Button size="icon-lg" onClick={onAdd} aria-label="Добавить продукт"><Plus /></Button></div>
      <button className="flux-food-search" type="button" onClick={onAdd}><Search /><span>Что вы съели?</span></button>
      <div className="flux-calorie-line"><span>{total.toLocaleString('ru-RU')} из {target.toLocaleString('ru-RU')} ккал</span><strong>{Math.round((total / target) * 100)}%</strong></div><Progress value={(total / target) * 100} />
      <section className="flux-meal-list"><div className="flux-section-heading"><h2>Приёмы пищи</h2></div>{entries.map((entry) => <div className="flux-meal-row" key={entry.entryId}><span>{entry.time}</span><p><strong>{entry.meal}</strong><small>{entry.name}</small></p><b>{entry.kcal}</b><ChevronRight /></div>)}</section>
      <Button className="flux-main-button" size="lg" onClick={onAdd}><Plus /> Добавить приём пищи</Button>
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
  const [entries, setEntries] = useState<MealEntry[]>(initialEntries);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const calorieTarget = 2000;

  const totals = useMemo(() => entries.reduce((sum, entry) => ({ kcal: sum.kcal + entry.kcal, protein: sum.protein + entry.protein, fat: sum.fat + entry.fat, carbs: sum.carbs + entry.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 }), [entries]);

  function addProduct(product: Product, amount = product.amount) {
    const scale = amount / product.amount;
    const entry: MealEntry = {
      ...product,
      amount,
      kcal: Math.round(product.kcal * scale),
      protein: Math.round(product.protein * scale),
      fat: Math.round(product.fat * scale),
      carbs: Math.round(product.carbs * scale),
      entryId: `${product.id}-${Date.now()}`,
      meal: 'Завтрак',
      time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date()),
    };
    setEntries((current) => [...current, entry]);
    toast.add({ title: `${product.name} добавлено`, description: `${amount} ${product.unit} · ${entry.kcal} ккал`, type: 'success' });
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
            <header className="flux-topbar"><button className="flux-brand" type="button" onClick={() => setTab('today')} aria-label="FLUX — главная"><FluxMark className="flux-logo" /><span>FLUX</span></button><Button className="flux-avatar" variant="secondary" size="icon" onClick={() => toast.add({ title: 'Профиль появится следующим', description: 'Настройки из онбординга подключим к Supabase.', type: 'info' })} aria-label="Открыть профиль">АК</Button></header>
            <div className="flux-content" id="top">
              {tab === 'today' && <TodayScreen totals={totals} target={calorieTarget} onAdd={(product) => addProduct(product)} onOpenFood={() => setQuickAddOpen(true)} onWorkout={() => setWorkoutOpen(true)} />}
              {tab === 'food' && <FoodScreen entries={entries} target={calorieTarget} onAdd={() => setQuickAddOpen(true)} />}
              {tab === 'workouts' && <WorkoutsScreen onStart={() => setWorkoutOpen(true)} />}
              {tab === 'progress' && <ProgressScreen />}
            </div>
            <nav className="flux-bottom-nav" aria-label="Основная навигация">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon /><span>{item.label}</span></button>; })}</nav>
          </div>
          {workoutOpen && <WorkoutFlow onClose={() => setWorkoutOpen(false)} />}
        </section>
      </main>
      <QuickAddDrawer open={quickAddOpen} onOpenChange={setQuickAddOpen} onAdd={addProduct} />
    </Toaster>
  );
}
