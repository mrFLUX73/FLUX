import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { createMyExercise, loadExerciseCatalogFilters, searchExerciseCatalog, type ExerciseCatalogFilterOption, type ExerciseCatalogItem, type PersonalExercise, type WorkoutExerciseSourceKind } from './repository';

type PickerExercise = {
  id: string;
  name: string;
  measurementType: PersonalExercise['measurementType'];
  instructions: string | null;
  primaryMuscleGroupName: string | null;
  equipment: string[];
  sourceKind: Extract<WorkoutExerciseSourceKind, 'catalog' | 'personal' | 'trainer_private'>;
};

type Props = {
  userId: string;
  open: boolean;
  personalExercises: PersonalExercise[];
  selectedSourceKeys: ReadonlySet<string>;
  addedCount: number;
  onOpenChange: (open: boolean) => void;
  onAdd: (exercise: PickerExercise) => void;
  onCreated: (exercise: PersonalExercise) => void;
  privateSourceKind?: Extract<WorkoutExerciseSourceKind, 'personal' | 'trainer_private'>;
};

const pageSize = 20;
const normalizeExerciseName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

function measurementLabel(value: PersonalExercise['measurementType']) {
  return value === 'duration' ? 'Время' : value === 'distance' ? 'Дистанция' : 'Повторения';
}

function catalogItem(item: ExerciseCatalogItem): PickerExercise {
  return { id: item.id, name: item.name, measurementType: item.measurementType, instructions: item.techniqueDescription, primaryMuscleGroupName: item.primaryMuscleGroupName || null, equipment: item.equipment, sourceKind: 'catalog' };
}

function personalItem(item: PersonalExercise, sourceKind: Props['privateSourceKind'] = 'personal'): PickerExercise {
  return { id: item.id, name: item.name, measurementType: item.measurementType, instructions: item.instructions, primaryMuscleGroupName: item.category, equipment: item.equipment ?? [], sourceKind };
}

export function ExerciseCatalogPicker({ userId, open, personalExercises, selectedSourceKeys, addedCount, onOpenChange, onAdd, onCreated, privateSourceKind = 'personal' }: Props) {
  const [tab, setTab] = useState<'catalog' | 'personal'>('catalog');
  const [query, setQuery] = useState('');
  const [muscleGroup, setMuscleGroup] = useState('');
  const [equipment, setEquipment] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ExerciseCatalogItem[]>([]);
  const [filters, setFilters] = useState<{ muscleGroups: ExerciseCatalogFilterOption[]; equipment: ExerciseCatalogFilterOption[] }>({ muscleGroups: [], equipment: [] });
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMeasurementType, setNewMeasurementType] = useState<PersonalExercise['measurementType']>('reps');
  const [newMuscleGroup, setNewMuscleGroup] = useState('');
  const [newEquipment, setNewEquipment] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<PersonalExercise | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const addGuard = useRef<Set<string>>(new Set());
  const createGuard = useRef(false);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => (createOpen ? createNameRef.current : inputRef.current)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [createOpen, open, tab]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFiltersLoading(true);
    void loadExerciseCatalogFilters(userId)
      .then((value) => { if (!cancelled) setFilters(value); })
      .catch(() => { if (!cancelled) setError('Не удалось загрузить фильтры каталога.'); })
      .finally(() => { if (!cancelled) setFiltersLoading(false); });
    return () => { cancelled = true; };
  }, [open, userId]);

  useEffect(() => {
    if (!open || tab !== 'catalog') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      void searchExerciseCatalog(userId, { query, muscleGroupSlug: muscleGroup || null, equipmentSlug: equipment || null, offset, limit: pageSize })
        .then((value) => { if (!cancelled) setItems(value); })
        .catch(() => { if (!cancelled) { setItems([]); setError('Не удалось загрузить упражнения. Проверьте соединение и повторите.'); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [equipment, muscleGroup, offset, open, query, tab, userId]);

  useEffect(() => {
    if (!open || !createOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setCreateOpen(false);
      window.requestAnimationFrame(() => createButtonRef.current?.focus());
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [createOpen, open]);

  const resetPage = (change: () => void) => { change(); setOffset(0); };
  const visibleItems = tab === 'catalog'
    ? items.map(catalogItem)
    : personalExercises.map((item) => personalItem(item, privateSourceKind)).filter((item) => item.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  const duplicate = useMemo(() => {
    const normalized = normalizeExerciseName(newName);
    return normalized ? personalExercises.find((item) => normalizeExerciseName(item.name) === normalized) ?? null : null;
  }, [newName, personalExercises]);
  const add = (item: PickerExercise) => {
    const key = `${item.sourceKind}:${item.id}`;
    if (addGuard.current.has(key)) return;
    addGuard.current.add(key); setPendingAdd(key); onAdd(item);
    window.setTimeout(() => { addGuard.current.delete(key); setPendingAdd((current) => current === key ? null : current); }, 300);
  };
  const resetCreateForm = () => {
    setNewName(''); setNewMeasurementType('reps'); setNewMuscleGroup(''); setNewEquipment(''); setNewInstructions(''); setCreateError('');
  };
  const closeCreate = () => {
    setCreateOpen(false);
    window.requestAnimationFrame(() => createButtonRef.current?.focus());
  };
  const create = async () => {
    const name = newName.trim();
    if (!name) { setCreateError('Укажите название упражнения.'); return; }
    if (name.length > 120) { setCreateError('Название должно быть не длиннее 120 символов.'); return; }
    if (duplicate) { setCreateError('У вас уже есть упражнение с таким названием.'); return; }
    if (createGuard.current) return;
    createGuard.current = true;
    setCreating(true); setCreateError('');
    try {
      const muscle = filters.muscleGroups.find((item) => item.slug === newMuscleGroup);
      const equipmentOption = filters.equipment.find((item) => item.slug === newEquipment);
      const created = await createMyExercise(userId, {
        name,
        measurementType: newMeasurementType,
        instructions: newInstructions,
        category: muscle?.name ?? null,
        primaryMuscles: muscle ? [muscle.name] : [],
        equipment: equipmentOption ? [equipmentOption.name] : [],
      });
      onCreated(created);
      setLastCreated(created);
      try {
        onAdd(personalItem(created, privateSourceKind));
      } catch {
        setCreateError('Упражнение создано. Добавьте его из списка «Мои упражнения».');
        return;
      }
      resetCreateForm();
      closeCreate();
    } catch {
      setCreateError('Не удалось создать упражнение. Проверьте соединение и повторите — данные формы сохранены.');
    } finally {
      createGuard.current = false;
      setCreating(false);
    }
  };
  const useExisting = () => {
    if (!duplicate) return;
    onAdd(personalItem(duplicate, privateSourceKind));
    setLastCreated(duplicate);
    resetCreateForm();
    closeCreate();
  };
  const emptyMessage = tab === 'catalog'
    ? (query || muscleGroup || equipment ? 'По вашему запросу ничего не найдено.' : 'В каталоге пока нет опубликованных упражнений.')
    : 'У вас пока нет личных упражнений. Создайте первое — оно останется только в вашей библиотеке.';

  return <Drawer open={open} onOpenChange={onOpenChange}>
    <DrawerContent className="flux-drawer flux-catalog-picker">
      <DrawerHeader className="flux-drawer-header flux-catalog-picker-header">
        <div><DrawerTitle>Добавить упражнение</DrawerTitle><DrawerDescription>Выберите источник — упражнение добавится только в черновик плана.</DrawerDescription></div>
        <button type="button" className="flux-drawer-back" onClick={() => onOpenChange(false)} aria-label="Закрыть каталог упражнений"><X /></button>
      </DrawerHeader>
      <div className="flux-catalog-picker-body">
        <div className="flux-catalog-tabs" role="tablist" aria-label="Источник упражнений">
          <button type="button" role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'is-active' : ''} onClick={() => { setCreateOpen(false); setTab('catalog'); setOffset(0); }}>Общий каталог</button>
          <button type="button" role="tab" aria-selected={tab === 'personal'} className={tab === 'personal' ? 'is-active' : ''} onClick={() => { setCreateOpen(false); setTab('personal'); setOffset(0); }}>Мои упражнения</button>
        </div>
        {createOpen ? <section className="flux-catalog-create" aria-labelledby="create-personal-exercise-title">
          <div className="flux-catalog-create-heading"><button type="button" className="flux-catalog-back" onClick={closeCreate} aria-label="Назад к моим упражнениям"><ChevronLeft aria-hidden="true" /></button><div><h3 id="create-personal-exercise-title">Своё упражнение</h3><p>Оно будет доступно только в вашей библиотеке.</p></div></div>
          <label>Название <input ref={createNameRef} aria-label="Название упражнения" value={newName} maxLength={120} placeholder="Например, тяга резинки" onChange={(event) => { setNewName(event.target.value); setCreateError(''); }} /></label>
          <fieldset className="flux-measurement-choice"><legend>Как измерять результат?</legend><div>{([{ type: 'reps', label: 'Повторения' }, { type: 'duration', label: 'Время' }, { type: 'distance', label: 'Дистанция' }] as const).map((item) => <button type="button" key={item.type} className={newMeasurementType === item.type ? 'is-active' : ''} aria-pressed={newMeasurementType === item.type} onClick={() => setNewMeasurementType(item.type)}>{item.label}</button>)}</div></fieldset>
          <div className="flux-catalog-create-options"><label>Основная мышечная группа<select aria-label="Основная мышечная группа" value={newMuscleGroup} onChange={(event) => setNewMuscleGroup(event.target.value)}><option value="">Не указывать</option>{filters.muscleGroups.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label><label>Оборудование<select aria-label="Оборудование упражнения" value={newEquipment} onChange={(event) => setNewEquipment(event.target.value)}><option value="">Не указывать</option>{filters.equipment.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label></div>
          <label>Техника выполнения <small>необязательно</small><textarea aria-label="Техника выполнения" value={newInstructions} maxLength={5000} placeholder="Короткая подсказка по технике" onChange={(event) => setNewInstructions(event.target.value)} /></label>
          {duplicate && <div className="flux-catalog-duplicate" role="status"><p>У вас уже есть «{duplicate.name}».</p><Button type="button" size="sm" variant="secondary" onClick={useExisting}>Использовать существующее</Button></div>}
          {createError && <p className="flux-client-inline-error" role="alert">{createError}</p>}
          <Button type="button" className="flux-main-button" disabled={!newName.trim() || creating} onClick={() => { void create(); }}>{creating ? <><LoaderCircle className="is-spinning" /> Создаём…</> : 'Создать и добавить'}</Button>
        </section> : <>
          <label className="flux-catalog-search"><Search aria-hidden="true" /><span className="sr-only">Поиск упражнения</span><input ref={inputRef} value={query} maxLength={160} placeholder={tab === 'catalog' ? 'Название или другое название' : 'Поиск в моих упражнениях'} onChange={(event) => resetPage(() => setQuery(event.target.value))} /></label>
          {tab === 'catalog' && <div className="flux-catalog-filters" aria-busy={filtersLoading}><label>Мышцы<select value={muscleGroup} onChange={(event) => resetPage(() => setMuscleGroup(event.target.value))}><option value="">Все группы</option>{filters.muscleGroups.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label><label>Оборудование<select value={equipment} onChange={(event) => resetPage(() => setEquipment(event.target.value))}><option value="">Любое</option>{filters.equipment.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label></div>}
          {tab === 'catalog' && error ? <div className="flux-catalog-state"><p>{error}</p><Button size="sm" onClick={() => setOffset((value) => value === 0 ? 1 : 0)}>Повторить</Button></div> : tab === 'catalog' && loading ? <div className="flux-catalog-state" aria-live="polite"><LoaderCircle className="is-spinning" /><p>Ищем упражнения…</p></div> : visibleItems.length ? <div className="flux-catalog-list" role="list">{visibleItems.map((item) => {
            const key = `${item.sourceKind}:${item.id}`;
            const selected = selectedSourceKeys.has(key);
            const adding = pendingAdd === key;
            return <article key={key} role="listitem" className={selected ? 'is-selected' : ''}><div className="flux-catalog-card-main"><div><strong>{item.name}</strong><span>{item.primaryMuscleGroupName ?? 'Личное упражнение'} · {measurementLabel(item.measurementType)}</span>{item.equipment.length ? <small>{item.equipment.join(' · ')}</small> : null}</div>{selected && <span className="flux-catalog-added"><Check aria-hidden="true" /> В черновике</span>}</div>{item.instructions ? <details><summary>Техника выполнения</summary><p>{item.instructions}</p></details> : null}<Button size="sm" variant={selected ? 'secondary' : 'default'} disabled={adding} onClick={() => add(item)}><Plus aria-hidden="true" /> {adding ? 'Добавляем…' : selected ? 'Добавить ещё' : 'Добавить'}</Button></article>;
          })}</div> : <div className="flux-catalog-state"><p>{emptyMessage}</p></div>}
          {tab === 'personal' && <Button ref={createButtonRef} className="flux-catalog-create-trigger" variant="secondary" onClick={() => { setCreateError(''); setCreateOpen(true); }}><Plus aria-hidden="true" /> Создать упражнение</Button>}
          {lastCreated && tab === 'personal' && <p className="flux-catalog-created" role="status"><Check aria-hidden="true" /> «{lastCreated.name}» добавлено в черновик.</p>}
          {tab === 'catalog' && !loading && !error && (offset > 0 || items.length === pageSize) && <nav className="flux-catalog-pagination" aria-label="Страницы каталога"><Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}><ChevronLeft aria-hidden="true" /> Назад</Button><span>Страница {Math.floor(offset / pageSize) + 1}</span><Button size="sm" variant="secondary" disabled={items.length < pageSize} onClick={() => setOffset((value) => value + pageSize)}>Далее <ChevronRight aria-hidden="true" /></Button></nav>}
        </>}
      </div>
      {!createOpen && <footer className="flux-catalog-picker-footer">
        <Button type="button" className="flux-main-button" size="lg" onClick={() => onOpenChange(false)}>Готово · Добавлено {addedCount}</Button>
        <p>Вернёт к настройке плана — сам план ещё не сохранён.</p>
      </footer>}
    </DrawerContent>
  </Drawer>;
}

export type { PickerExercise };
