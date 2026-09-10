import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type TouchEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Banana,
  Camera,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  CloudSun,
  Coffee,
  Dumbbell,
  Flashlight,
  FlashlightOff,
  House,
  LoaderCircle,
  Minus,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScanBarcode,
  Search,
  ShieldCheck,
  Sprout,
  Trash2,
  Utensils,
  Wheat,
  WifiOff,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  PhonePasswordAuthGate,
  type PhoneAuthMode,
  type PhoneAuthSubmission,
} from './features/auth/PhonePasswordAuthGate';
import {
  getCurrentAccount,
  cacheAccount,
  clearCachedAccount,
  loadCachedAccount,
  registerWithLogin,
  signOutFlux,
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
import { fallbackProducts, matchesProductSearch, productSearchRank } from './features/nutrition/catalog';
import { decodeBarcodeImage, startBarcodeScanner, type BarcodeScannerSession } from './features/nutrition/barcodeScanner';
import { getNutriapixProduct, lookupProductByBarcode, searchProductsByName, type ProductSearchCandidate } from './features/nutrition/productSearch';
import { submitProductSuggestion } from './features/nutrition/productSuggestions';
import {
  addRemoteMealEntry,
  bootstrapNutrition,
  claimGuestDiaryForNewUser,
  countGuestDiaryEntries,
  deleteRemoteMealEntry,
  guestNutritionScope,
  isSameNutritionScope,
  loadLocalEntriesForDay,
  loadLocalEntriesForToday,
  loadNutritionEntriesForDay,
  loadPreviousMealEntries,
  nutritionScopeForUser,
  persistLocalEntriesForToday,
  persistLocalProduct,
  persistNewLocalEntry,
  persistNewLocalEntries,
  persistUpdatedLocalEntry,
  queueRemoteMealDeletion,
  queueRemoteMealUpdate,
  removeLocalEntryFromStorage,
  updateRemoteMealEntry,
  type NutritionMode,
  type NutritionStorageScope,
} from './features/nutrition/repository';
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabase';
import {
  createProfileDraft,
  ProfileAvatar,
  ProfileScreen,
  type DefaultAvatar,
  type FluxTheme,
  type ProfileDraft,
} from './features/profile/ProfileScreen';
import { loadCachedProfileDraft, loadCachedProfileTheme, loadProfileDraft, saveProfileDraft } from './features/profile/repository';
import { AdminFeedbackScreen, FeedbackDrawer } from './features/feedback/FeedbackUI';
import { countUnreadFeedbackReplies } from './features/feedback/repository';
import {
  MEAL_KINDS,
  type MealEntry,
  type MealKind,
  type NutritionTotals,
  type Product,
} from './features/nutrition/types';

type Tab = 'today' | 'food' | 'workouts' | 'progress' | 'admin';
type ScannerState = 'idle' | 'requesting' | 'scanning' | 'error';
type ManualProductDraft = {
  name: string;
  brand: string;
  amount: string;
  unit: 'г' | 'мл';
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
};

const defaultMacroTargets = { protein: 110, fat: 70, carbs: 230 };

function positiveTarget(value: string | undefined, fallback: number) {
  const target = Number(value);
  return Number.isFinite(target) && target > 0 ? target : fallback;
}
const themeBrowserColors: Record<FluxTheme, string> = {
  sage: '#fbfdf9',
  storm: '#f8f9f8',
  ocean: '#f9fcfc',
  bloom: '#fdfafb',
  sand: '#fdfbf7',
  night: '#111714',
};

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateFromDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, Number.isFinite(month) ? month : 0, day || 1);
}

function dayLabel(dayKey: string) {
  const date = dateFromDayKey(dayKey);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

function weekDays(selectedDay: string) {
  const selected = dateFromDayKey(selectedDay);
  const mondayOffset = (selected.getDay() + 6) % 7;
  const monday = new Date(selected);
  monday.setDate(selected.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      key: localDayKey(date),
      date,
      weekday: new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', ''),
    };
  });
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

function productCountLabel(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'продуктов';
  if (mod10 === 1) return 'продукт';
  if (mod10 >= 2 && mod10 <= 4) return 'продукта';
  return 'продуктов';
}

function formatMacro(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function emptyManualProduct(name = ''): ManualProductDraft {
  return { name, brand: '', amount: '', unit: 'г', kcal: '', protein: '', fat: '', carbs: '' };
}

function draftNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function ProductIcon({ type }: { type: Product['icon'] }) {
  const Icon = type === 'wheat' ? Wheat : type === 'banana' ? Banana : type === 'coffee' ? Coffee : Utensils;
  return <Icon aria-hidden="true" />;
}

function productLookupSource(product: Product) {
  if (product.id.startsWith('nutriapix:')) return 'Nutriapix';
  if (product.id.startsWith('open-food-facts:')) return 'Open Food Facts';
  if (product.id.startsWith('fatsecret:')) return 'FatSecret';
  if (product.id.startsWith('manual-barcode:')) return 'вручную';
  return null;
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
  syncsProducts,
  suggestionUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: Product, amount: number, meal: MealKind) => Promise<void>;
  products: Product[];
  entries: MealEntry[];
  initialProduct: Product | null;
  initialMeal: MealKind;
  syncsProducts: boolean;
  suggestionUserId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [amount, setAmount] = useState<number | ''>(180);
  const [meal, setMeal] = useState<MealKind>(initialMeal);
  const [isAdding, setIsAdding] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerState, setScannerState] = useState<ScannerState>('idle');
  const [scannerMessage, setScannerMessage] = useState('');
  const [scannerDetail, setScannerDetail] = useState('');
  const [scannerAttempt, setScannerAttempt] = useState(0);
  const [scannerPhotoBusy, setScannerPhotoBusy] = useState(false);
  const [scannerSupportsTorch, setScannerSupportsTorch] = useState(false);
  const [scannerTorchOn, setScannerTorchOn] = useState(false);
  const [manualProductOpen, setManualProductOpen] = useState(false);
  const [manualProduct, setManualProduct] = useState<ManualProductDraft>(() => emptyManualProduct());
  const [barcodeProducts, setBarcodeProducts] = useState<Product[]>([]);
  const [nameCandidates, setNameCandidates] = useState<ProductSearchCandidate[]>([]);
  const [nameLookupState, setNameLookupState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [nameLookupMessage, setNameLookupMessage] = useState('');
  const [selectingCandidate, setSelectingCandidate] = useState('');
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'not_found' | 'incomplete' | 'error'>('idle');
  const [lookupMessage, setLookupMessage] = useState('');
  const [lookupProductName, setLookupProductName] = useState('');
  const [suggestionState, setSuggestionState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const barcodeQuery = query.replace(/\D/g, '');
  const isBarcodeQuery = /^\d{8,14}$/.test(barcodeQuery);
  const scannerVideoRef = useRef<HTMLVideoElement>(null);
  const scannerSessionRef = useRef<BarcodeScannerSession | null>(null);
  const scannerPhotoInputRef = useRef<HTMLInputElement>(null);
  const detectedBarcodeRef = useRef('');

  useEffect(() => {
    if (!open) return;
    setMeal(initialMeal);
    setSelected(initialProduct);
    setAmount(initialProduct?.amount ?? 180);
    setScannerOpen(false);
    setScannerState('idle');
    setScannerMessage('');
    setScannerDetail('');
    setScannerAttempt(0);
    setScannerPhotoBusy(false);
    setScannerSupportsTorch(false);
    setScannerTorchOn(false);
    setManualProductOpen(false);
    setManualProduct(emptyManualProduct());
    setBarcodeProducts([]);
    setNameCandidates([]);
    setNameLookupState('idle');
    setNameLookupMessage('');
    setSelectingCandidate('');
    setLookupState('idle');
    setLookupMessage('');
    setLookupProductName('');
  }, [initialMeal, initialProduct, open]);

  const finishScannedBarcode = useCallback((barcode: string) => {
    if (detectedBarcodeRef.current) return;
    detectedBarcodeRef.current = barcode;
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = null;
    if ('vibrate' in navigator) navigator.vibrate(80);
    // A scan starts a new search, not a continuation of the text search that
    // opened the drawer. Clear its selection and result lists synchronously so
    // a previous card (for example, "Творог") cannot remain on screen while
    // the barcode lookup is in flight.
    setSelected(null);
    setBarcodeProducts([]);
    setNameCandidates([]);
    setNameLookupState('idle');
    setNameLookupMessage('');
    setLookupState('loading');
    setLookupMessage('');
    setLookupProductName('');
    setQuery(barcode);
    setScannerOpen(false);
    toast.add({
      title: 'Штрихкод считан',
      description: `${barcode} · ищем продукт`,
      type: 'success',
    });
  }, []);

  function beginScanner() {
    // Reset before the camera opens as well. This makes returning from a
    // cancelled or unreadable scan land on a neutral search screen.
    detectedBarcodeRef.current = '';
    setSelected(null);
    setQuery('');
    setBarcodeProducts([]);
    setNameCandidates([]);
    setNameLookupState('idle');
    setNameLookupMessage('');
    setLookupState('idle');
    setLookupMessage('');
    setLookupProductName('');
    setScannerAttempt((attempt) => attempt + 1);
    setScannerOpen(true);
  }

  useEffect(() => {
    if (!open || !scannerOpen) return;

    let active = true;
    detectedBarcodeRef.current = '';
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = null;
    setScannerState('requesting');
    setScannerMessage('');
    setScannerDetail('');
    setScannerPhotoBusy(false);
    setScannerSupportsTorch(false);
    setScannerTorchOn(false);

    async function startScanner() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setScannerState('error');
        setScannerMessage('Камера доступна только в защищённой версии сайта. Откройте FLUX по HTTPS.');
        return;
      }

      try {
        if (!active || !scannerVideoRef.current) return;
        const session = await startBarcodeScanner({
          video: scannerVideoRef.current,
          onBarcode: (barcode) => {
            if (active) finishScannedBarcode(barcode);
          },
          onReady: ({ width, height, supportsTorch, continuousFocusRequested }) => {
            if (!active) return;
            setScannerState('scanning');
            setScannerSupportsTorch(supportsTorch);
            setScannerDetail(
              continuousFocusRequested
                ? `Фокусируемся на коде · камера ${width}×${height}`
                : `Ищем штрихкод на упаковке · камера ${width}×${height}`,
            );
          },
        });

        if (!active) session.stop();
        else scannerSessionRef.current = session;
      } catch (error) {
        if (!active) return;
        const name = error instanceof DOMException ? error.name : '';
        setScannerState('error');
        setScannerMessage(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Доступ к камере запрещён. Разрешите его в настройках Safari для этого сайта.'
            : name === 'NotFoundError' || name === 'DevicesNotFoundError'
              ? 'На устройстве не найдена доступная камера.'
              : name === 'NotReadableError' || name === 'TrackStartError'
                ? 'Камера занята другим приложением. Закройте его и попробуйте снова.'
                : 'Не удалось запустить камеру. Можно ввести цифры штрихкода вручную.',
        );
      }
    }

    void startScanner();
    return () => {
      active = false;
      scannerSessionRef.current?.stop();
      scannerSessionRef.current = null;
    };
  }, [finishScannedBarcode, open, scannerAttempt, scannerOpen]);

  useEffect(() => {
    if (!open || !isBarcodeQuery) {
      setBarcodeProducts([]);
      setLookupState('idle');
      setLookupMessage('');
      setLookupProductName('');
      return;
    }

    const savedProduct = products.find((product) => product.barcode === barcodeQuery);
    if (savedProduct) {
      setBarcodeProducts([]);
      setLookupState('found');
      setLookupMessage('');
      setLookupProductName(savedProduct.name);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setBarcodeProducts([]);
    setLookupState('loading');
    setLookupMessage('');
    setLookupProductName('');
    const searchTimer = window.setTimeout(async () => {
      // Barcode lookups query several independent sources. Give the complete
      // chain enough time to include FatSecret rather than cancelling it while
      // Open Food Facts and Nutriapix are still responding.
      const requestTimer = window.setTimeout(() => controller.abort(), 15000);
      try {
        const result = await lookupProductByBarcode(barcodeQuery, controller.signal);
        if (!active) return;
        if (result.status === 'found') {
          setBarcodeProducts(result.products?.length ? result.products : [result.product]);
          setLookupState('found');
          setLookupProductName(result.product.name);
          return;
        }
        setLookupState(result.status);
        setLookupProductName(result.status === 'incomplete' ? result.name : '');
        setLookupMessage(result.status === 'incomplete'
          ? `${result.name} найден, но в источнике нет полного КБЖУ.`
          : result.status === 'error' ? result.message : 'Такого штрихкода пока нет в подключённой базе.');
      } catch (error) {
        if (!active) return;
        setLookupState('error');
        setLookupMessage(error instanceof DOMException && error.name === 'AbortError'
          ? 'Поиск занял слишком много времени. Попробуйте ещё раз.'
          : 'Не удалось связаться с базой продуктов');
      } finally {
        window.clearTimeout(requestTimer);
      }
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [barcodeQuery, isBarcodeQuery, open, products]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || isBarcodeQuery || normalized.length < 3) {
      setNameCandidates([]);
      setNameLookupState('idle');
      setNameLookupMessage('');
      return;
    }
    const controller = new AbortController();
    let active = true;
    setNameLookupState('loading');
    setNameLookupMessage('');
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchProductsByName(normalized, controller.signal);
        if (!active) return;
        if (result.status === 'found') {
          setNameCandidates(result.candidates);
          setNameLookupState('idle');
          return;
        }
        setNameCandidates([]);
        setNameLookupState(result.status === 'error' ? 'error' : 'idle');
        setNameLookupMessage(result.status === 'error' ? result.message : '');
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setNameCandidates([]);
        setNameLookupState('error');
        setNameLookupMessage('Поиск источников временно недоступен.');
      }
    }, 400);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [isBarcodeQuery, open, query]);

  const recentIds = [...entries]
    .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
    .map((entry) => entry.productId)
    .filter((id): id is string => Boolean(id));
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const searchableProducts = query.trim()
    ? [
      ...products,
      ...barcodeProducts.filter((candidate) => !products.some((product) => product.barcode === candidate.barcode)),
    ]
    : products;
  const filtered = searchableProducts
    .filter((product) => matchesProductSearch(product, normalizedQuery))
    .sort((a, b) => {
      if (query.trim()) {
        const rankDifference = productSearchRank(b, normalizedQuery) - productSearchRank(a, normalizedQuery);
        return rankDifference || a.name.localeCompare(b.name, 'ru');
      }
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
    setSuggestionState('idle');
    setScannerOpen(false);
    setManualProductOpen(false);
  }

  async function chooseSearchCandidate(candidate: ProductSearchCandidate) {
    if (candidate.source === 'open_food_facts' || candidate.source === 'fatsecret') {
      choose(candidate.product);
      return;
    }
    if (selectingCandidate) return;
    const controller = new AbortController();
    setSelectingCandidate(candidate.slug);
    try {
      const result = await getNutriapixProduct(candidate.slug, controller.signal);
      if (result.status === 'found') choose(result.product);
      else toast.add({ title: 'Карточка пока недоступна', description: result.status === 'error' ? result.message : 'Попробуйте выбрать другой результат или добавьте продукт вручную.', type: 'warning' });
    } finally {
      setSelectingCandidate('');
    }
  }

  function updateManualProduct(field: keyof ManualProductDraft, value: string) {
    setManualProduct((draft) => ({ ...draft, [field]: value }));
  }

  async function scanPhoto(event: ChangeEvent<HTMLInputElement>) {
    const photo = event.target.files?.[0];
    event.target.value = '';
    if (!photo) return;

    setScannerPhotoBusy(true);
    setScannerDetail('Проверяем фотографию кода…');
    try {
      const barcode = await decodeBarcodeImage(photo);
      if (barcode) {
        finishScannedBarcode(barcode);
        return;
      }
      setScannerDetail('На фото код не прочитан. Попробуйте без бликов и теней.');
      toast.add({
        title: 'Штрихкод не прочитан',
        description: 'Сфотографируйте код целиком, без бликов, или введите цифры вручную.',
        type: 'warning',
      });
    } catch {
      setScannerDetail('Не удалось обработать фотографию. Попробуйте ещё раз.');
      toast.add({
        title: 'Не удалось прочитать фото',
        description: 'Попробуйте снять код ещё раз или введите его вручную.',
        type: 'error',
      });
    } finally {
      setScannerPhotoBusy(false);
    }
  }

  async function toggleScannerTorch() {
    if (!scannerSessionRef.current?.supportsTorch) return;
    try {
      await scannerSessionRef.current.setTorch(!scannerTorchOn);
      setScannerTorchOn((value) => !value);
    } catch {
      toast.add({ title: 'Не удалось включить подсветку', description: 'Попробуйте изменить освещение вокруг упаковки.', type: 'warning' });
    }
  }

  function openManualProduct() {
    setManualProduct(emptyManualProduct(isBarcodeQuery ? lookupProductName : query.trim()));
    setManualProductOpen(true);
  }

  const manualAmount = draftNumber(manualProduct.amount);
  const manualKcal = draftNumber(manualProduct.kcal);
  const manualProtein = draftNumber(manualProduct.protein);
  const manualFat = draftNumber(manualProduct.fat);
  const manualCarbs = draftNumber(manualProduct.carbs);
  const manualProductIsValid = Boolean(
    manualProduct.name.trim()
    && manualAmount !== null && manualAmount > 0
    && manualKcal !== null
    && manualProtein !== null
    && manualFat !== null
    && manualCarbs !== null,
  );

  function continueWithManualProduct() {
    if (!manualProductIsValid || manualAmount === null || manualKcal === null || manualProtein === null || manualFat === null || manualCarbs === null) return;
    const scale = manualAmount / 100;
    choose({
      id: isBarcodeQuery ? `manual-barcode:${barcodeQuery}:${Date.now()}` : `manual:${Date.now()}`,
      ...(isBarcodeQuery ? { barcode: barcodeQuery } : {}),
      name: manualProduct.name.trim(),
      brand: manualProduct.brand.trim() || 'Без бренда',
      amount: manualAmount,
      unit: manualProduct.unit,
      servingSizeG: manualAmount,
      kcal: Math.round(manualKcal * scale),
      protein: Math.round(manualProtein * scale * 10) / 10,
      fat: Math.round(manualFat * scale * 10) / 10,
      carbs: Math.round(manualCarbs * scale * 10) / 10,
      icon: manualProduct.unit === 'мл' ? 'coffee' : 'curd',
      isManual: true,
    });
  }

  function close() {
    onOpenChange(false);
    window.setTimeout(() => {
      setSelected(null);
      setSuggestionState('idle');
      setQuery('');
      setIsAdding(false);
      setScannerOpen(false);
      setScannerState('idle');
      setScannerMessage('');
      setScannerDetail('');
      setScannerPhotoBusy(false);
      setScannerSupportsTorch(false);
      setScannerTorchOn(false);
      setManualProductOpen(false);
      setManualProduct(emptyManualProduct());
      setBarcodeProducts([]);
      setNameCandidates([]);
      setNameLookupState('idle');
      setNameLookupMessage('');
      setSelectingCandidate('');
      setLookupState('idle');
      setLookupMessage('');
    }, 250);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => {
        setSelected(null);
        setSuggestionState('idle');
        setQuery('');
        setIsAdding(false);
        setScannerOpen(false);
        setScannerState('idle');
        setScannerMessage('');
        setScannerDetail('');
        setScannerPhotoBusy(false);
        setScannerSupportsTorch(false);
        setScannerTorchOn(false);
        setManualProductOpen(false);
        setManualProduct(emptyManualProduct());
        setBarcodeProducts([]);
        setNameCandidates([]);
        setNameLookupState('idle');
        setNameLookupMessage('');
        setSelectingCandidate('');
        setLookupState('idle');
        setLookupMessage('');
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
  const selectedSource = selected ? productLookupSource(selected) : null;
  const selectedIsNewToCatalog = Boolean(selected && selected.source !== 'nutriapix' && selected.barcode && !products.some((product) => product.barcode === selected.barcode));
  const amountStep = selected?.unit === 'шт' ? 1 : 10;
  const amountMinimum = selected?.unit === 'шт' ? 1 : 10;
  const portionPresets = selected
    ? [...new Set(selected.unit === 'шт'
      ? [1, 2, 3]
      : selected.unit === 'мл'
        ? [200, 250, selected.amount]
        : selected.barcode
          ? [100, selected.amount, selected.amount / 2]
          : [100, 150, selected.amount])]
    : [];

  async function suggestForSharedCatalog() {
    if (!selected || !suggestionUserId || suggestionState !== 'idle') return;
    setSuggestionState('sending');
    try {
      await submitProductSuggestion(suggestionUserId, selected);
      setSuggestionState('sent');
      toast.add({ title: 'Отправлено на проверку', description: 'После проверки карточка сможет появиться в общей базе FLUX.', type: 'success' });
    } catch (error) {
      setSuggestionState('idle');
      toast.add({ title: 'Не удалось отправить', description: error instanceof Error ? error.message : 'Проверьте интернет и попробуйте ещё раз.', type: 'error' });
    }
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer">
        <DrawerHeader className={`flux-drawer-header ${scannerOpen || manualProductOpen ? 'is-scanner' : ''}`}>
          {(scannerOpen || manualProductOpen) && <button type="button" className="flux-drawer-back" onClick={() => scannerOpen ? setScannerOpen(false) : setManualProductOpen(false)} aria-label="Назад к поиску"><ArrowLeft /></button>}
          <div>
            <DrawerTitle>{scannerOpen ? 'Сканировать штрихкод' : manualProductOpen ? 'Новый продукт' : selected ? selected.name : 'Добавить еду'}</DrawerTitle>
            <DrawerDescription>{scannerOpen ? 'Наведите камеру на код упаковки' : manualProductOpen ? (isBarcodeQuery ? `Штрихкод ${barcodeQuery}` : 'Укажите данные с упаковки') : selected ? selected.brand : `Сегодня · ${meal}`}</DrawerDescription>
          </div>
        </DrawerHeader>
        {!scannerOpen && !manualProductOpen && <div className="flux-meal-picker" role="group" aria-label="Приём пищи">
          {MEAL_KINDS.map((kind) => (
            <button key={kind} type="button" className={meal === kind ? 'is-active' : ''} onClick={() => setMeal(kind)}>
              {kind}
            </button>
          ))}
        </div>}
        {scannerOpen ? (
          <div className="flux-scanner-view">
            <div className={`flux-camera-preview is-${scannerState}`}>
              <video ref={scannerVideoRef} muted playsInline autoPlay aria-label="Изображение с камеры" />
              <span className="flux-camera-corner is-top-left" /><span className="flux-camera-corner is-top-right" />
              <span className="flux-camera-corner is-bottom-left" /><span className="flux-camera-corner is-bottom-right" />
              <span className="flux-scan-line" />
              {scannerState === 'requesting' && <span className="flux-camera-placeholder"><LoaderCircle className="is-spinning" /></span>}
              {scannerState === 'error' && <span className="flux-camera-placeholder is-error"><ScanBarcode /></span>}
            </div>
            <div className={`flux-scanning-status is-${scannerState}`} role="status" aria-live="polite">
              {scannerState === 'requesting' && <><LoaderCircle className="is-spinning" /> Запрашиваем доступ к камере…</>}
              {scannerState === 'scanning' && <><span className="flux-camera-pulse" /> {scannerDetail || 'Ищем штрихкод на упаковке…'}</>}
              {scannerState === 'error' && scannerMessage}
            </div>
            <div className="flux-scanner-actions">
              <input ref={scannerPhotoInputRef} className="flux-camera-file-input" type="file" accept="image/*" capture="environment" onChange={scanPhoto} />
              <Button variant="secondary" className="flux-camera-photo" disabled={scannerPhotoBusy} onClick={() => scannerPhotoInputRef.current?.click()}>
                {scannerPhotoBusy ? <LoaderCircle className="is-spinning" /> : <Camera />}
                {scannerPhotoBusy ? 'Считываем фото…' : 'Сделать фото кода'}
              </Button>
              {scannerSupportsTorch && (
                <Button variant="secondary" size="icon" className="flux-camera-torch" onClick={() => void toggleScannerTorch()} aria-label={scannerTorchOn ? 'Выключить подсветку' : 'Включить подсветку'} aria-pressed={scannerTorchOn}>
                  {scannerTorchOn ? <FlashlightOff /> : <Flashlight />}
                </Button>
              )}
            </div>
            {scannerState === 'error' && (
              <Button variant="secondary" className="flux-camera-retry" onClick={() => setScannerAttempt((attempt) => attempt + 1)}>
                Попробовать снова
              </Button>
            )}
            <button type="button" className="flux-text-button" onClick={() => setScannerOpen(false)}>Ввести штрихкод вручную</button>
          </div>
        ) : manualProductOpen ? (
          <div className="flux-manual-product-view">
            <div className="flux-manual-intro">
              <span><Plus /></span>
              <p><strong>Добавим продукт в FLUX</strong>Перепишите значения с упаковки. КБЖУ обычно указаны на 100 г или 100 мл.</p>
            </div>
            <div className="flux-manual-fields">
              <label className="is-wide"><span>Название продукта</span><Input value={manualProduct.name} onChange={(event) => updateManualProduct('name', event.target.value)} placeholder="Например, творог обезжиренный" autoFocus /></label>
              <label className="is-wide"><span>Бренд</span><Input value={manualProduct.brand} onChange={(event) => updateManualProduct('brand', event.target.value)} placeholder="Можно не указывать" /></label>
              <label><span>В упаковке</span><Input value={manualProduct.amount} onChange={(event) => updateManualProduct('amount', event.target.value)} inputMode="decimal" placeholder="180" /></label>
              <div className="flux-manual-unit" role="group" aria-label="Единица упаковки">
                {(['г', 'мл'] as const).map((unit) => <button type="button" key={unit} className={manualProduct.unit === unit ? 'is-active' : ''} onClick={() => setManualProduct((draft) => ({ ...draft, unit }))}>{unit}</button>)}
              </div>
            </div>
            <div className="flux-manual-macro-title"><strong>КБЖУ на 100 {manualProduct.unit}</strong><span>с этикетки</span></div>
            <div className="flux-manual-macros">
              <label><span>Калории</span><Input value={manualProduct.kcal} onChange={(event) => updateManualProduct('kcal', event.target.value)} inputMode="decimal" placeholder="0" /><small>ккал</small></label>
              <label><span>Белки</span><Input value={manualProduct.protein} onChange={(event) => updateManualProduct('protein', event.target.value)} inputMode="decimal" placeholder="0" /><small>г</small></label>
              <label><span>Жиры</span><Input value={manualProduct.fat} onChange={(event) => updateManualProduct('fat', event.target.value)} inputMode="decimal" placeholder="0" /><small>г</small></label>
              <label><span>Углеводы</span><Input value={manualProduct.carbs} onChange={(event) => updateManualProduct('carbs', event.target.value)} inputMode="decimal" placeholder="0" /><small>г</small></label>
            </div>
            <Button className="flux-main-button" size="lg" disabled={!manualProductIsValid} onClick={continueWithManualProduct}>
              <span>Продолжить</span><ArrowRight />
            </Button>
            <p className="flux-manual-hint">{syncsProducts
              ? 'Сохраним в вашем каталоге — продукт появится и на других устройствах.'
              : 'Пока сохраним на этом устройстве. После входа данные можно синхронизировать.'}</p>
          </div>
        ) : selected ? (
          <div className="flux-portion-view">
            {selected.barcode && (
              <div className="flux-product-confirmation">
                <span><Check /></span>
                <p>
                  <strong>{selectedSource ? `Найдено через ${selectedSource}` : 'Продукт из вашего каталога'}</strong>
                  {selected.source === 'nutriapix'
                    ? 'КБЖУ показаны из Nutriapix. В дневник сохранится выбранная порция, а карточка не будет добавлена в каталог.'
                    : selectedIsNewToCatalog
                    ? 'Сверьте название и КБЖУ с упаковкой. После добавления сохраним продукт в вашем каталоге.'
                    : 'Можно сразу добавить — этот продукт уже сохранён в вашем каталоге.'}
                </p>
              </div>
            )}
            <div className="flux-portion-caption"><span>Количество</span><span>{selected.barcode ? 'Упаковка' : 'Обычно'}: {selected.amount} {selected.unit}</span></div>
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
                  {selected.barcode && preset === selected.amount / 2
                    ? '½ упаковки'
                    : `${preset === selected.amount ? `${selected.barcode ? 'Упаковка' : 'Обычно'} · ` : ''}${preset} ${selected.unit}`}
                </button>
              ))}
            </div>
            <div className="flux-nutrient-grid">
              <div><span>Калории</span><strong><MorphNumber value={Math.round(selected.kcal * scale)} /></strong><small>ккал</small></div>
              <div><span>Белки</span><strong><MorphNumber value={formatMacro(selected.protein * scale)} /></strong><small>г</small></div>
              <div><span>Жиры</span><strong><MorphNumber value={formatMacro(selected.fat * scale)} /></strong><small>г</small></div>
              <div><span>Углеводы</span><strong><MorphNumber value={formatMacro(selected.carbs * scale)} /></strong><small>г</small></div>
            </div>
            <Button className="flux-main-button" size="lg" disabled={isAdding || numericAmount <= 0} onClick={() => submit(selected, numericAmount)}>
              <span>{isAdding ? 'Сохраняю…' : `Добавить в ${mealInSentence(meal)}`}</span><strong>{Math.round(selected.kcal * scale)} ккал</strong>
            </Button>
            {suggestionUserId && selected.source !== 'nutriapix' && (selected.isManual || selectedIsNewToCatalog) && (
              <div className="flux-product-suggestion">
                <div><strong>Помочь общей базе?</strong><span>Карточка останется личной, пока команда FLUX не сверит её.</span></div>
                <Button type="button" variant="secondary" disabled={suggestionState !== 'idle'} onClick={() => { void suggestForSharedCatalog(); }}>
                  {suggestionState === 'sending' ? <><LoaderCircle className="is-spinning" /> Отправляю…</> : suggestionState === 'sent' ? <><Check /> Уже предложено</> : 'Предложить в общую базу'}
                </Button>
              </div>
            )}
            <button type="button" className="flux-text-button" onClick={() => setSelected(null)}><ArrowLeft /> Назад к продуктам</button>
          </div>
        ) : (
          <div className="flux-quick-add-view">
            <label className={`flux-search-field ${query ? 'has-clear' : ''}`}>
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Продукт, бренд или штрихкод" aria-label="Найти продукт, бренд или штрихкод" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X /></button>}
              <button type="button" className="flux-scan-button" onClick={(event) => { event.preventDefault(); beginScanner(); }} aria-label="Сканировать штрихкод"><ScanBarcode /></button>
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
              <div className={`flux-section-heading ${isBarcodeQuery && filtered.length ? 'flux-results-heading' : ''}`}>
                <h2>{isBarcodeQuery ? 'Результат по штрихкоду' : query ? 'Результаты поиска' : recentIds.length ? 'Недавние и частые' : 'Популярные продукты'}</h2>
                {isBarcodeQuery && filtered.length > 0 && <span className="flux-found-pill">Найдено</span>}
              </div>
              {isBarcodeQuery && lookupState === 'loading' && (
                <div className="flux-lookup-state"><LoaderCircle className="is-spinning" /><span>Ищем продукт и проверяем КБЖУ…</span></div>
              )}
              {filtered.map((product) => {
                const isBarcodeMatch = isBarcodeQuery && product.barcode === barcodeQuery;
                const kcalPer100 = Math.round(product.kcal / product.servingSizeG * 100);
                const externalSource = productLookupSource(product);
                const isSavedInCatalog = products.some((candidate) => candidate.barcode === barcodeQuery);
                return (
                  <div key={product.id} className={isBarcodeMatch ? 'flux-product-match' : undefined}>
                    <button type="button" className={`flux-product-row ${isBarcodeMatch ? 'is-barcode-match' : ''}`} onClick={() => choose(product)}>
                      <span className="flux-food-icon"><ProductIcon type={product.icon} /></span>
                      <span><strong>{product.name}</strong><small>{product.brand} · {isBarcodeMatch ? product.amount : 'обычно ' + product.amount} {product.unit}</small>{isBarcodeMatch && <em>{kcalPer100} ккал на 100 {product.unit === 'мл' ? 'мл' : 'г'}</em>}</span>
                      {!isBarcodeMatch && <span><strong>{product.kcal}</strong><small>ккал</small></span>}
                      <ChevronRight aria-hidden="true" />
                    </button>
                    {isBarcodeMatch && <div className="flux-product-note"><span><Check /></span><p><strong>{externalSource ? `Найдено через ${externalSource}` : isSavedInCatalog ? 'Уже в вашем каталоге' : 'Продукт FLUX'}</strong>{isSavedInCatalog ? 'Можно выбрать порцию и сразу добавить в приём пищи.' : 'Сверьте название и КБЖУ с упаковкой: после добавления сохраним продукт в вашем каталоге.'}</p></div>}
                  </div>
                );
              })}
              {!isBarcodeQuery && nameLookupState === 'loading' && <div className="flux-lookup-state"><LoaderCircle className="is-spinning" /><span>Ищем в базах продуктов…</span></div>}
              {!isBarcodeQuery && nameCandidates.map((candidate) => (
                <button type="button" className="flux-product-row" key={candidate.source === 'nutriapix' ? candidate.slug : candidate.product.id} onClick={() => { void chooseSearchCandidate(candidate); }} disabled={candidate.source === 'nutriapix' && Boolean(selectingCandidate)}>
                  <span className="flux-food-icon"><ProductIcon type="curd" /></span>
                  <span><strong>{candidate.name}</strong><small>{candidate.brand} · {candidate.source === 'nutriapix' ? 'Nutriapix' : candidate.source === 'fatsecret' ? 'FatSecret' : 'Open Food Facts'}</small></span>
                  {candidate.source === 'nutriapix' && selectingCandidate === candidate.slug ? <LoaderCircle className="is-spinning" /> : <ChevronRight aria-hidden="true" />}
                </button>
              ))}
              {!isBarcodeQuery && nameLookupState === 'error' && <div className="flux-lookup-state is-error"><span>{nameLookupMessage}</span></div>}
              {filtered.length === 0 && nameCandidates.length === 0 && lookupState !== 'loading' && nameLookupState !== 'loading' && (
                <div className="flux-empty">
                  <strong>{isBarcodeQuery && lookupState === 'incomplete' ? 'Нужно дополнить КБЖУ' : 'Ничего не нашли'}</strong>
                  <span>{isBarcodeQuery ? lookupMessage || 'Введите от 8 до 14 цифр штрихкода.' : 'Укажите КБЖУ с упаковки — продукт сохранится в вашем каталоге.'}</span>
                  {((isBarcodeQuery && ['not_found', 'incomplete', 'error'].includes(lookupState)) || (!isBarcodeQuery && query.trim())) && <Button variant="secondary" onClick={openManualProduct}><Plus /> {isBarcodeQuery ? 'Добавить вручную' : `Добавить «${query.trim()}» вручную`}</Button>}
                </div>
              )}
            </section>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function RepeatMealDrawer({
  open,
  meal,
  entries,
  selectedIds,
  saving,
  onOpenChange,
  onToggle,
  onToggleAll,
  onConfirm,
}: {
  open: boolean;
  meal: MealKind;
  entries: MealEntry[];
  selectedIds: Set<string>;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (entryId: string) => void;
  onToggleAll: () => void;
  onConfirm: () => void;
}) {
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.entryId));
  const selectedCalories = selectedEntries.reduce((sum, entry) => sum + entry.kcal, 0);
  const sourceDate = entries[0]
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(entries[0].eatenAt))
    : '';
  const allSelected = entries.length > 0 && selectedEntries.length === entries.length;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer flux-repeat-drawer">
        <DrawerHeader className="flux-drawer-header">
          <div>
            <DrawerTitle>Повторить {mealInSentence(meal)}</DrawerTitle>
            <DrawerDescription>{sourceDate ? `Последний приём · ${sourceDate}` : 'Выберите продукты'}</DrawerDescription>
          </div>
        </DrawerHeader>
        <div className="flux-repeat-toolbar">
          <span>{entries.length} {productCountLabel(entries.length)}</span>
          <button type="button" onClick={onToggleAll}>{allSelected ? 'Снять выбор' : 'Выбрать все'}</button>
        </div>
        <div className="flux-repeat-list">
          {entries.map((entry) => {
            const selected = selectedIds.has(entry.entryId);
            return (
              <button
                className={`flux-repeat-row${selected ? ' is-selected' : ''}`}
                type="button"
                key={entry.entryId}
                aria-pressed={selected}
                onClick={() => onToggle(entry.entryId)}
              >
                <span className="flux-repeat-check">{selected && <Check />}</span>
                <span><strong>{entry.name}</strong><small>{entry.amount} {entry.unit} · {entry.brand}</small></span>
                <b>{entry.kcal}<small> ккал</small></b>
              </button>
            );
          })}
        </div>
        <div className="flux-repeat-summary"><span>Будет добавлено</span><strong>{selectedEntries.length} · {selectedCalories} ккал</strong></div>
        <Button className="flux-main-button flux-repeat-confirm" size="lg" disabled={!selectedEntries.length || saving} onClick={onConfirm}>
          {saving ? <LoaderCircle className="is-spinning" /> : <Clock3 />} Повторить приём пищи
        </Button>
      </DrawerContent>
    </Drawer>
  );
}

function EditMealEntryDrawer({
  entry,
  open,
  saving,
  onOpenChange,
  onSave,
}: {
  entry: MealEntry | null;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (entry: MealEntry, amount: number, meal: MealKind) => void;
}) {
  const [amount, setAmount] = useState<number | ''>(entry?.amount ?? '');
  const [meal, setMeal] = useState<MealKind>(entry?.meal ?? 'Завтрак');

  useEffect(() => {
    if (!open || !entry) return;
    setAmount(entry.amount);
    setMeal(entry.meal);
  }, [entry, open]);

  if (!entry) return null;
  const numericAmount = typeof amount === 'number' ? amount : 0;
  const amountStep = entry.unit === 'шт' ? 1 : 10;
  const amountMinimum = entry.unit === 'шт' ? 1 : 10;
  const scale = numericAmount / entry.amount;
  const presets = [...new Set(entry.unit === 'шт'
    ? [1, 2, 3]
    : [100, entry.amount, Math.max(amountMinimum, Math.round(entry.amount / 2 / amountStep) * amountStep)])];

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer">
        <DrawerHeader className="flux-drawer-header">
          <div>
            <DrawerTitle>Изменить продукт</DrawerTitle>
            <DrawerDescription>{entry.name} · {entry.brand}</DrawerDescription>
          </div>
        </DrawerHeader>
        <div className="flux-meal-picker" role="group" aria-label="Приём пищи">
          {MEAL_KINDS.map((kind) => (
            <button key={kind} type="button" className={meal === kind ? 'is-active' : ''} onClick={() => setMeal(kind)}>{kind}</button>
          ))}
        </div>
        <div className="flux-portion-view">
          <div className="flux-portion-caption"><span>Количество</span><span>Было: {entry.amount} {entry.unit}</span></div>
          <div className="flux-portion-stepper">
            <Button variant="secondary" size="icon-lg" onClick={() => setAmount((value) => Math.max(amountMinimum, (Number(value) || entry.amount) - amountStep))} aria-label="Уменьшить количество"><Minus /></Button>
            <label><input className="flux-portion-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value === '' ? '' : Math.max(0, Number(event.target.value)))} onBlur={() => { if (!numericAmount) setAmount(entry.amount); }} aria-label={`Количество, ${entry.unit}`} /><span>{entry.unit}</span></label>
            <Button variant="secondary" size="icon-lg" onClick={() => setAmount((value) => (Number(value) || entry.amount) + amountStep)} aria-label="Увеличить количество"><Plus /></Button>
          </div>
          <div className="flux-portion-presets">
            {presets.map((preset) => <button type="button" key={preset} className={numericAmount === preset ? 'is-active' : ''} onClick={() => setAmount(preset)}>{preset} {entry.unit}</button>)}
          </div>
          <div className="flux-nutrient-grid">
            <div><span>Калории</span><strong><MorphNumber value={Math.round(entry.kcal * scale)} /></strong><small>ккал</small></div>
            <div><span>Белки</span><strong><MorphNumber value={formatMacro(entry.protein * scale)} /></strong><small>г</small></div>
            <div><span>Жиры</span><strong><MorphNumber value={formatMacro(entry.fat * scale)} /></strong><small>г</small></div>
            <div><span>Углеводы</span><strong><MorphNumber value={formatMacro(entry.carbs * scale)} /></strong><small>г</small></div>
          </div>
          <Button className="flux-main-button" size="lg" disabled={saving || numericAmount <= 0} onClick={() => onSave(entry, numericAmount, meal)}>
            {saving ? <LoaderCircle className="is-spinning" /> : <Check />} {saving ? 'Сохраняю…' : 'Сохранить изменения'}
          </Button>
        </div>
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
  macroTargets,
  entries,
  weekActivity,
  onEditBalance,
}: {
  totals: NutritionTotals;
  target: number;
  macroTargets: typeof defaultMacroTargets;
  entries: MealEntry[];
  weekActivity: { key: string; weekday: string; day: number; hasFood: boolean }[];
  onEditBalance: () => void;
}) {
  const remaining = Math.max(0, target - totals.kcal);
  const progress = Math.min(100, Math.round((totals.kcal / target) * 100));
  const mealsLogged = new Set(entries.map((entry) => entry.meal)).size;
  const overFat = totals.fat - macroTargets.fat;
  const remainingProtein = Math.max(0, macroTargets.protein - totals.protein);
  const focus = overFat > 0
    ? { eyebrow: 'Фокус дня', title: `Жиры выше цели на ${formatMacro(overFat)} г`, body: 'Следующий приём можно сделать легче по жирам.' }
    : remainingProtein > 0
      ? { eyebrow: 'Фокус дня', title: `До цели по белку ${formatMacro(remainingProtein)} г`, body: 'Небольшой белковый продукт поможет собрать баланс.' }
      : { eyebrow: 'Фокус дня', title: 'Баланс на сегодня собран', body: 'Вы держите выбранный ориентир спокойно и без спешки.' };
  const macros = [
    { label: 'Белки', value: totals.protein, target: macroTargets.protein },
    { label: 'Жиры', value: totals.fat, target: macroTargets.fat },
    { label: 'Углеводы', value: totals.carbs, target: macroTargets.carbs },
  ];

  return (
    <>
      <button className="flux-balance-card flux-balance-card--interactive" type="button" onClick={onEditBalance} aria-label="Изменить дневной баланс">
        <div className="flux-balance-heading"><div><span className="flux-eyebrow">Баланс на сегодня <small>· изменить цели</small></span><strong><MorphNumber value={remaining.toLocaleString('ru-RU')} /> <small>ккал осталось</small></strong></div><div className="flux-ring" style={{ '--flux-progress': `${progress * 3.6}deg` } as CSSProperties}><span>{progress}%</span></div></div>
        <div className="flux-macro-grid">{macros.map((macro) => <div key={macro.label}><span>{macro.label}</span><strong>{macro.value} / {macro.target} г</strong><Progress value={(macro.value / macro.target) * 100} aria-label={`${macro.label}: ${macro.value} из ${macro.target} грамм`} /></div>)}</div>
      </button>
      <section className="flux-today-rhythm" aria-label="Ритм дня">
        <div className="flux-section-heading"><h2>Ритм дня</h2><span>Спокойно, по шагам</span></div>
        <div className="flux-rhythm-grid">
          <article><span className="flux-rhythm-icon"><Utensils /></span><small>Питание</small><strong>{mealsLogged} из 4 приёмов</strong><p>{entries.length ? `${entries.length} ${productCountLabel(entries.length)} в дневнике` : 'Дневник пока пуст'}</p></article>
          <article><span className="flux-rhythm-icon"><Dumbbell /></span><small>Тренировка</small><strong>Запланирована</strong><p>Всё тело · 28 мин</p></article>
        </div>
      </section>
      <section className="flux-daily-focus"><span className="flux-focus-mark"><Sprout /></span><div><small>{focus.eyebrow}</small><strong>{focus.title}</strong><p>{focus.body}</p></div></section>
      <section className="flux-week-glance" aria-label="Неделя в движении">
        <div className="flux-section-heading"><h2>Эта неделя</h2><span>Дневник питания</span></div>
        <div className="flux-week-dots">{weekActivity.map((day) => <div key={day.key} className={day.hasFood ? 'is-filled' : ''}><small>{day.weekday}</small><span>{day.day}</span></div>)}</div>
        <p>{weekActivity.filter((day) => day.hasFood).length} из 7 дней с записями питания</p>
      </section>
    </>
  );
}

function DailyBalanceDrawer({
  open,
  draft,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  draft: ProfileDraft | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (nextDraft: ProfileDraft) => void;
}) {
  const [values, setValues] = useState({ calories: '', protein: '', fat: '', carbs: '' });

  useEffect(() => {
    if (!open || !draft) return;
    setValues({
      calories: draft.dailyCalories,
      protein: draft.dailyProteinG,
      fat: draft.dailyFatG,
      carbs: draft.dailyCarbsG,
    });
  }, [draft, open]);

  if (!draft) return null;
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="flux-drawer flux-balance-drawer">
        <DrawerHeader className="flux-drawer-header">
          <div>
            <DrawerTitle>Баланс на каждый день</DrawerTitle>
            <DrawerDescription>Ваш личный ориентир по калориям и БЖУ.</DrawerDescription>
          </div>
        </DrawerHeader>
        <div className="flux-balance-editor">
          <p>Изменения применятся к сегодняшнему балансу. Записанные продукты останутся без изменений.</p>
          <label className="flux-balance-editor-main"><span>Калории</span><i><input inputMode="numeric" min="500" max="10000" type="number" value={values.calories} onChange={(event) => set('calories', event.target.value)} /> <b>ккал</b></i></label>
          <div className="flux-balance-editor-macros">
            <label><span>Белки</span><i><input inputMode="decimal" min="0" max="1000" step="0.1" type="number" value={values.protein} onChange={(event) => set('protein', event.target.value)} /> <b>г</b></i></label>
            <label><span>Жиры</span><i><input inputMode="decimal" min="0" max="500" step="0.1" type="number" value={values.fat} onChange={(event) => set('fat', event.target.value)} /> <b>г</b></i></label>
            <label><span>Углеводы</span><i><input inputMode="decimal" min="0" max="1500" step="0.1" type="number" value={values.carbs} onChange={(event) => set('carbs', event.target.value)} /> <b>г</b></i></label>
          </div>
          <Button className="flux-main-button" size="lg" disabled={saving} onClick={() => onSave({ ...draft, dailyCalories: values.calories, dailyProteinG: values.protein, dailyFatG: values.fat, dailyCarbsG: values.carbs })}>
            {saving ? <LoaderCircle className="is-spinning" /> : <Check />} {saving ? 'Сохраняю…' : 'Сохранить баланс'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function FoodScreen({
  entries,
  target,
  selectedDay,
  onSelectDay,
  historyLoading,
  mode,
  isConnecting,
  isAuthenticated,
  onAdd,
  onEdit,
  onRemove,
  onRepeat,
  repeatLoadingMeal,
}: {
  entries: MealEntry[];
  target: number;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  historyLoading: boolean;
  mode: NutritionMode;
  isConnecting: boolean;
  isAuthenticated: boolean;
  onAdd: (meal?: MealKind) => void;
  onEdit: (entry: MealEntry) => void;
  onRemove: (entry: MealEntry) => void;
  onRepeat: (meal: MealKind) => void;
  repeatLoadingMeal: MealKind | null;
}) {
  const total = entries.reduce((sum, entry) => sum + entry.kcal, 0);
  const isSynced = mode === 'supabase' && isAuthenticated;
  const todayKey = localDayKey();
  const isToday = selectedDay === todayKey;
  const days = weekDays(selectedDay);
  const weekStart = dayLabel(days[0].key);
  const weekEnd = dayLabel(days[6].key);
  const shiftWeek = (direction: -1 | 1) => {
    const next = dateFromDayKey(selectedDay);
    next.setDate(next.getDate() + direction * 7);
    if (next > new Date()) return;
    onSelectDay(localDayKey(next));
  };
  return (
    <>
      <section className="flux-food-calendar" aria-label="Календарь питания">
        <header><button type="button" onClick={() => shiftWeek(-1)} aria-label="Показать предыдущую неделю">Раньше</button><strong>{weekStart} — {weekEnd}</strong><button type="button" onClick={() => shiftWeek(1)} disabled={days[6].date >= new Date()} aria-label="Показать следующую неделю">Позже</button></header>
        <div>{days.map(({ key, date, weekday }) => {
          const future = date > new Date();
          const selected = key === selectedDay;
          return <button key={key} type="button" disabled={future} className={selected ? 'is-selected' : ''} onClick={() => onSelectDay(key)} aria-pressed={selected}><small>{weekday}</small><strong>{date.getDate()}</strong></button>;
        })}</div>
        {!isToday && <p>История за {dayLabel(selectedDay)}. Нажмите на карандаш рядом с продуктом, чтобы изменить порцию или приём пищи.</p>}
      </section>
      <p className={`flux-sync-status ${isSynced ? 'is-cloud' : ''}`} role="status">
        {isConnecting
          ? <><LoaderCircle className="is-spinning" /> Обновляем данные…</>
          : isSynced
            ? <><Cloud /> Сохранено в профиле</>
            : <><WifiOff /> {isAuthenticated ? 'Сохранено на устройстве' : 'Гостевой дневник на устройстве'}</>}
      </p>
      {isToday && <button className="flux-food-search" type="button" onClick={() => onAdd()}><Search /><span>Что вы съели?</span></button>}
      <div className="flux-calorie-line"><span>{total.toLocaleString('ru-RU')} из {target.toLocaleString('ru-RU')} ккал</span><strong>{Math.round((total / target) * 100)}%</strong></div><Progress value={(total / target) * 100} />
      <section className="flux-meal-list">
        <div className="flux-section-heading"><h2>{historyLoading ? 'Загружаем день…' : 'Приёмы пищи'}</h2></div>
        {!historyLoading && entries.length === 0 && <div className="flux-diary-empty"><Sprout /><strong>Дневник пока пуст</strong><span>{isToday ? 'Добавьте первый продукт — баланс пересчитается сразу.' : 'В этот день пока нет записей.'}</span></div>}
        {MEAL_KINDS.map((meal) => {
          const mealEntries = entries.filter((entry) => entry.meal === meal);
          const mealCalories = mealEntries.reduce((sum, entry) => sum + entry.kcal, 0);
          return (
            <article className="flux-meal-group" key={meal}>
              <header>
                <div><strong>{meal}</strong><span>{mealCalories ? `${mealCalories} ккал` : 'Пока пусто'}</span></div>
                {isToday && <div className="flux-meal-actions">
                  <button type="button" onClick={() => onRepeat(meal)} disabled={repeatLoadingMeal !== null} aria-label={`Повторить предыдущий ${mealInSentence(meal)}`}>
                    {repeatLoadingMeal === meal ? <LoaderCircle className="is-spinning" /> : <Clock3 />}
                  </button>
                  <button type="button" onClick={() => onAdd(meal)} aria-label={`Добавить в ${mealInSentence(meal)}`}><Plus /></button>
                </div>}
              </header>
              {mealEntries.map((entry) => (
                <div className="flux-meal-row" key={entry.entryId}>
                  <span>{entry.time}</span>
                  <p><strong>{entry.name}</strong><small>{entry.amount} {entry.unit} · {entry.brand}</small></p>
                  <b>{entry.kcal}</b>
                  <button type="button" className="flux-edit-entry" onClick={() => onEdit(entry)} aria-label={`Изменить ${entry.name}`}><Pencil /></button>
                  <button type="button" className="flux-remove-entry" onClick={() => onRemove(entry)} aria-label={`Удалить ${entry.name}`}><Trash2 /></button>
                </div>
              ))}
            </article>
          );
        })}
      </section>
      {isToday && <Button className="flux-main-button" size="lg" onClick={() => onAdd()}><Plus /> Добавить продукт</Button>}
    </>
  );
}

function WorkoutsScreen({ onStart }: { onStart: () => void }) {
  const [weather, setWeather] = useState<{ temperature: number; apparent: number; wind: number; label: string } | null>(null);
  const [weatherState, setWeatherState] = useState<'idle' | 'loading' | 'denied' | 'error'>('idle');

  const loadWeather = () => {
    if (!navigator.geolocation) {
      setWeatherState('error');
      return;
    }
    setWeatherState('loading');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const query = new URLSearchParams({
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
          current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
          wind_speed_unit: 'ms',
          timezone: 'auto',
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
        if (!response.ok) throw new Error('weather unavailable');
        const data = await response.json() as { current?: { temperature_2m?: number; apparent_temperature?: number; wind_speed_10m?: number; weather_code?: number } };
        const current = data.current;
        if (typeof current?.temperature_2m !== 'number') throw new Error('weather unavailable');
        const weatherCode = current.weather_code ?? 0;
        const label = weatherCode === 0 ? 'ясно' : weatherCode <= 2 ? 'переменная облачность' : weatherCode === 3 ? 'облачно' : weatherCode <= 48 ? 'туман' : weatherCode <= 67 ? 'дождь' : weatherCode <= 77 ? 'снег' : 'гроза';
        setWeather({
          temperature: Math.round(current.temperature_2m),
          apparent: Math.round(current.apparent_temperature ?? current.temperature_2m),
          wind: Math.round(current.wind_speed_10m ?? 0),
          label,
        });
        setWeatherState('idle');
      } catch {
        setWeatherState('error');
      }
    }, () => setWeatherState('denied'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 });
  };

  return (
    <>
      <section className="flux-workout-weather" aria-label="Погода для тренировки на улице">
        <span className="flux-workout-weather-icon"><CloudSun /></span>
        <div>{weather ? <><small>На улице сейчас</small><strong>{weather.temperature > 0 ? '+' : ''}{weather.temperature}° · {weather.label}</strong><p>Ощущается как {weather.apparent > 0 ? '+' : ''}{weather.apparent}° · ветер {weather.wind} м/с</p></> : <><small>Для тренировки на улице</small><strong>{weatherState === 'denied' ? 'Геолокация не разрешена' : weatherState === 'error' ? 'Погода пока недоступна' : 'Узнать погоду рядом'}</strong><p>{weatherState === 'denied' ? 'Разрешите геолокацию в настройках браузера.' : 'Подскажем, что ждёт вас за дверью.'}</p></>}</div>
        {!weather && <button type="button" onClick={loadWeather} disabled={weatherState === 'loading'}>{weatherState === 'loading' ? <LoaderCircle className="is-spinning" /> : 'Показать'}</button>}
      </section>
      <section className="flux-workout-page-hero"><span>План на сегодня <i>28 мин</i></span><strong>Всё тело</strong><p>Спокойная тренировка без гонки за результатом.</p><div><Play /> {workoutExercises.length} упражнения · 3 круга</div><Button onClick={onStart}><Play /> Начать</Button></section>
      <section className="flux-exercise-list"><div className="flux-section-heading"><h2>План</h2><span>Начальный</span></div>{workoutExercises.map((exercise, index) => <div key={exercise.name}><span>0{index + 1}</span><p><strong>{exercise.name}</strong><small>{exercise.reps} повторений</small></p><ChevronRight /></div>)}</section>
    </>
  );
}

function ProgressScreen() {
  const week = [42, 68, 55, 82, 71, 20, 12];
  return (
    <>
      <section className="flux-streak-card"><span><Sprout /></span><div><small>Ваш ритм · 4 недели</small><strong>12 дней в движении</strong><p>Не идеально. Зато стабильно.</p></div></section>
      <section className="flux-week-card"><div className="flux-section-heading"><h2>Эта неделя</h2></div><div className="flux-week-bars">{week.map((height, index) => <div key={index}><i className={index === 4 ? 'is-today' : ''} style={{ height: `${height}%` }} /><span>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index]}</span></div>)}</div></section>
      <div className="flux-stat-grid"><div><span>Тренировки</span><strong>3</strong><small>из 3 на неделе</small></div><div><span>Средний баланс</span><strong>−240</strong><small>ккал в день</small></div></div>
    </>
  );
}

function InitializationScreen() {
  return (
    <section className="flux-initialization" role="status" aria-live="polite" aria-label="FLUX загружается">
      <div className="flux-initialization-mark" aria-hidden="true">
        <i />
        <img src={`${import.meta.env.BASE_URL}brand/flux-mark.png`} alt="" draggable="false" />
      </div>
      <img className="flux-initialization-lockup" src={`${import.meta.env.BASE_URL}brand/flux-lockup.png`} alt="FLUX" draggable="false" />
      <p>Настраиваем FLUX под вас</p>
      <div className="flux-initialization-dots" aria-hidden="true"><i /><i /><i /></div>
    </section>
  );
}

export default function App() {
  const startupAccountRef = useRef<FluxAccount | null>(loadCachedAccount());
  const startupProfileRef = useRef(startupAccountRef.current
    ? loadCachedProfileDraft(startupAccountRef.current.id, startupAccountRef.current)
    : null);
  const startupScope = startupAccountRef.current
    ? nutritionScopeForUser(startupAccountRef.current.id)
    : guestNutritionScope;
  const [tab, setTab] = useState<Tab>('today');
  const [diary, setDiary] = useState<{
    scope: NutritionStorageScope;
    entries: MealEntry[];
    hydrated: boolean;
  }>(() => ({
    scope: startupScope,
    entries: loadLocalEntriesForToday(startupScope),
    hydrated: true,
  }));
  const [selectedNutritionDay, setSelectedNutritionDay] = useState(() => localDayKey());
  const [historyLoading, setHistoryLoading] = useState(false);
  const entries = diary.entries;
  const nutritionScopeRef = useRef<NutritionStorageScope>(startupScope);
  const nutritionGeneration = useRef(0);
  const nutritionEditRevision = useRef(0);
  const nutritionHydratedRef = useRef(true);
  const activeDay = useRef(localDayKey());
  const [catalog, setCatalog] = useState<Product[]>(fallbackProducts);
  const [nutritionMode, setNutritionMode] = useState<NutritionMode>('local');
  const [nutritionConnecting, setNutritionConnecting] = useState(true);
  const pullStartY = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullFeedback, setPullFeedback] = useState<'idle' | 'refreshing' | 'updated' | 'error'>('idle');
  const pullFeedbackTimer = useRef<number | null>(null);
  const [account, setAccount] = useState<FluxAccount | null>(startupAccountRef.current);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [profileHydratedUserId, setProfileHydratedUserId] = useState<string | null>(
    startupProfileRef.current && startupAccountRef.current ? startupAccountRef.current.id : null,
  );
  const [startupVisible, setStartupVisible] = useState(true);
  const startupStartedAt = useRef(Date.now());
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const wasOnline = useRef(navigator.onLine);
  const [authGateOpen, setAuthGateOpen] = useState(false);
  const [authGateMode, setAuthGateMode] = useState<PhoneAuthMode>('signup');
  const [guestDiaryEntryCount, setGuestDiaryEntryCount] = useState(() => countGuestDiaryEntries());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddProduct, setQuickAddProduct] = useState<Product | null>(null);
  const [quickAddMeal, setQuickAddMeal] = useState<MealKind>(() => currentMeal());
  const [repeatMealOpen, setRepeatMealOpen] = useState(false);
  const [repeatMeal, setRepeatMeal] = useState<MealKind>('Завтрак');
  const [repeatCandidates, setRepeatCandidates] = useState<MealEntry[]>([]);
  const [repeatSelectedIds, setRepeatSelectedIds] = useState<Set<string>>(() => new Set());
  const [repeatLoadingMeal, setRepeatLoadingMeal] = useState<MealKind | null>(null);
  const [repeatSaving, setRepeatSaving] = useState(false);
  const repeatRequestRevision = useRef(0);
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null);
  const [entrySaving, setEntrySaving] = useState(false);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dailyBalanceOpen, setDailyBalanceOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(startupProfileRef.current?.draft ?? null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackScreen, setFeedbackScreen] = useState('Сегодня');
  const [unreadFeedbackReplies, setUnreadFeedbackReplies] = useState(0);
  const [defaultAvatar, setDefaultAvatar] = useState<DefaultAvatar>(startupProfileRef.current?.avatar ?? 'short-hair');
  const profileEditRevision = useRef(0);
  const calorieTarget = positiveTarget(profileDraft?.dailyCalories, 2000);
  const macroTargets = {
    protein: positiveTarget(profileDraft?.dailyProteinG, defaultMacroTargets.protein),
    fat: positiveTarget(profileDraft?.dailyFatG, defaultMacroTargets.fat),
    carbs: positiveTarget(profileDraft?.dailyCarbsG, defaultMacroTargets.carbs),
  };

  useEffect(() => {
    let active = true;
    const baselineRevision = 0;
    profileEditRevision.current = baselineRevision;
    setProfileOpen(false);
    if (account) {
      const initialDraft = createProfileDraft(account);
      const cachedProfile = loadCachedProfileDraft(account.id, account);
      const cachedTheme = loadCachedProfileTheme(account.id);
      setProfileDraft(cachedProfile?.draft ?? (cachedTheme ? { ...initialDraft, theme: cachedTheme } : initialDraft));
      setDefaultAvatar(cachedProfile?.avatar ?? 'short-hair');
      setProfileHydratedUserId(account.id);
    } else {
      setProfileDraft(null);
      setDefaultAvatar('short-hair');
      setProfileHydratedUserId(null);
    }
    setProfileSaving(false);
    if (account) {
      void loadProfileDraft(account.id, account).then((stored) => {
        if (!active || profileEditRevision.current !== baselineRevision) return;
        setProfileDraft(stored.draft);
        setDefaultAvatar(stored.avatar);
      }).catch(() => {
        // Keep the editable account-based draft when the network is offline.
      }).finally(() => {
        if (active && profileEditRevision.current === baselineRevision) {
          setProfileHydratedUserId(account.id);
        }
      });
    }
    return () => { active = false; };
  }, [account?.id]);

  useEffect(() => {
    let active = true;
    if (!account) {
      setUnreadFeedbackReplies(0);
      return () => { active = false; };
    }
    void countUnreadFeedbackReplies(account.id)
      .then((count) => { if (active) setUnreadFeedbackReplies(count); })
      .catch(() => { if (active) setUnreadFeedbackReplies(0); });
    return () => { active = false; };
  }, [account?.id]);

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
    let initialSessionStarted = false;

    const hydrateSession = async (sessionAccount: FluxAccount | null) => {
      const generation = ++nutritionGeneration.current;
      const editRevision = nutritionEditRevision.current;
      const scope = sessionAccount ? nutritionScopeForUser(sessionAccount.id) : guestNutritionScope;
      const localEntries = loadLocalEntriesForToday(scope);
      nutritionScopeRef.current = scope;
      nutritionHydratedRef.current = true;
      setAccount(sessionAccount);
      if (sessionAccount) cacheAccount(sessionAccount);
      else clearCachedAccount();
      setNutritionMode('local');
      setNutritionConnecting(true);
      setQuickAddOpen(false);
      setRepeatMealOpen(false);
      setSelectedNutritionDay(localDayKey());
      setDiary({ scope, entries: localEntries, hydrated: true });
      setSessionResolved(true);

      if (sessionAccount) {
        const resolvedAccount = await Promise.race([
          getCurrentAccount().catch(() => sessionAccount),
          new Promise<FluxAccount>((resolve) => window.setTimeout(() => resolve(sessionAccount), 2_500)),
        ]);
        if (!active || generation !== nutritionGeneration.current) return;
        if (!resolvedAccount || resolvedAccount.id !== sessionAccount.id) {
          await hydrateSession(null);
          return;
        }
        setAccount(resolvedAccount);
        cacheAccount(resolvedAccount);
      }

      const result = await bootstrapNutrition(scope, localEntries);
      if (!active || generation !== nutritionGeneration.current || !isSameNutritionScope(scope, nutritionScopeRef.current)) return;
      setNutritionMode(result.mode);
      if (result.products.length) setCatalog(result.products);
      if (editRevision === nutritionEditRevision.current) {
        setDiary({ scope, entries: result.entries, hydrated: true });
      }
      setNutritionConnecting(false);
    };

    const localSessionFallback = window.setTimeout(() => {
      if (!active || initialSessionStarted) return;
      initialSessionStarted = true;
      void hydrateSession(loadCachedAccount());
    }, 1_800);

    void getSupabaseClient()
      .then((client) => {
        if (!active) return;
        if (!client) {
          void hydrateSession(null);
          return;
        }

        const { data } = client.auth.onAuthStateChange((event, session) => {
          initialSessionStarted = true;
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
            isAdmin: false,
          } : null;

          window.setTimeout(() => {
            if (active) void hydrateSession(sessionAccount);
          }, 0);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => { if (active) void hydrateSession(loadCachedAccount()); });

    return () => {
      active = false;
      window.clearTimeout(localSessionFallback);
      unsubscribe?.();
      nutritionGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    const connectionWasRestored = isOnline && !wasOnline.current;
    wasOnline.current = isOnline;
    if (!connectionWasRestored || !sessionResolved) return;
    void connectNutrition().catch(() => {
      // The next browser online event or a manual retry will try again.
    });
  }, [isOnline, sessionResolved]);

  const startupDataReady = sessionResolved && (!account || profileHydratedUserId === account.id);

  useEffect(() => {
    if (!startupVisible || !startupDataReady) return;
    const minimumDuration = 850;
    const remaining = Math.max(0, minimumDuration - (Date.now() - startupStartedAt.current));
    const timer = window.setTimeout(() => setStartupVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [startupDataReady, startupVisible]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const todayKey = localDayKey();
    if (!sessionResolved) return;
    if (selectedNutritionDay === todayKey) {
      const scope = nutritionScopeRef.current;
      setDiary((current) => isSameNutritionScope(current.scope, scope)
        ? { scope, entries: loadLocalEntriesForToday(scope), hydrated: true }
        : current);
      return;
    }
    let active = true;
    setHistoryLoading(true);
    const scope = nutritionScopeRef.current;
    void loadNutritionEntriesForDay(scope, selectedNutritionDay, catalog).then((result) => {
      if (!active || !isSameNutritionScope(scope, nutritionScopeRef.current)) return;
      setNutritionMode(result.mode);
      setDiary({ scope, entries: result.entries, hydrated: true });
    }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [catalog, selectedNutritionDay, sessionResolved]);

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(async () => {
      const nextDay = localDayKey();
      if (nextDay === activeDay.current) return;
      activeDay.current = nextDay;
      setSelectedNutritionDay(nextDay);
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
    if (diary.hydrated && selectedNutritionDay === localDayKey()) persistLocalEntriesForToday(diary.scope, diary.entries);
  }, [diary, selectedNutritionDay]);

  const totals = useMemo(() => entries.reduce((sum, entry) => ({ kcal: sum.kcal + entry.kcal, protein: sum.protein + entry.protein, fat: sum.fat + entry.fat, carbs: sum.carbs + entry.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 }), [entries]);
  const weekActivity = useMemo(() => {
    const today = new Date();
    const mondayOffset = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const key = localDayKey(date);
      const dayEntries = key === localDayKey() ? entries : loadLocalEntriesForDay(diary.scope, key);
      return {
        key,
        day: date.getDate(),
        weekday: new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', ''),
        hasFood: dayEntries.length > 0,
      };
    });
  }, [diary.scope, entries]);

  // Turnstile protects registration and sign-in only. A signed-in user must be
  // able to refresh their existing diary regardless of that widget's state.
  const firstName = account?.displayName.split(/\s+/)[0];
  const fluxTheme: FluxTheme = profileDraft?.theme ?? 'sage';

  useEffect(() => {
    document.documentElement.dataset.fluxTheme = fluxTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    if (themeColor) themeColor.content = themeBrowserColors[fluxTheme];
    return () => {
      delete document.documentElement.dataset.fluxTheme;
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
    };
  }, [fluxTheme]);

  function openProfile() {
    if (!account) {
      openAuth('signup');
      return;
    }
    setProfileDraft((current) => current ?? createProfileDraft(account));
    setProfileOpen(true);
  }

  function openDailyBalance() {
    if (!account) {
      openAuth('signup');
      return;
    }
    setProfileDraft((current) => current ?? createProfileDraft(account));
    setDailyBalanceOpen(true);
  }

  async function saveDailyBalance(nextDraft: ProfileDraft) {
    if (!account || profileSaving) return;
    setProfileSaving(true);
    try {
      await saveProfileDraft(account.id, nextDraft);
      setProfileDraft(nextDraft);
      setDailyBalanceOpen(false);
      toast.add({ title: 'Баланс сохранён', description: 'Новый ориентир уже применяется на сегодня.', type: 'success' });
    } catch {
      toast.add({ title: 'Не удалось сохранить баланс', description: 'Проверьте интернет и попробуйте ещё раз.', type: 'error' });
    } finally {
      setProfileSaving(false);
    }
  }

  function openFeedback(screen = tab === 'admin' ? 'Управление' : ({ today: 'Сегодня', food: 'Питание', workouts: 'Тренировки', progress: 'Прогресс' }[tab])) {
    if (!account) {
      openAuth('signup');
      return;
    }
    setFeedbackScreen(screen);
    setFeedbackOpen(true);
  }

  useEffect(() => {
    if (tab === 'admin' && !account?.isAdmin) setTab('today');
  }, [account?.isAdmin, tab]);

  async function completeProfile() {
    if (!account || !profileDraft || profileSaving) return;
    setProfileSaving(true);
    try {
      await saveProfileDraft(account.id, profileDraft);
      setAccount((current) => current?.id === account.id
        ? { ...current, displayName: profileDraft.displayName.trim() }
        : current);
      setProfileOpen(false);
      toast.add({
        title: 'Профиль сохранён',
        description: 'Данные синхронизированы и будут доступны на других устройствах.',
        type: 'success',
      });
    } catch (error) {
      toast.add({
        title: 'Не удалось сохранить профиль',
        description: error instanceof Error && error.message === 'Укажите имя и фамилию'
          ? error.message
          : 'Проверьте интернет и попробуйте ещё раз.',
        type: 'error',
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function signOut() {
    try {
      await signOutFlux();
      setProfileOpen(false);
      setFeedbackOpen(false);
      toast.add({ title: 'Вы вышли из аккаунта', description: 'Можно войти в другой профиль или создать новый.', type: 'info' });
    } catch {
      toast.add({ title: 'Не удалось выйти', description: 'Проверьте соединение и повторите попытку.', type: 'error' });
    }
  }

  async function connectNutrition() {
    const scope = diary.scope;
    const localEntries = diary.entries;
    const generation = nutritionGeneration.current;
    const editRevision = nutritionEditRevision.current;
    setNutritionConnecting(true);
    try {
      const result = await bootstrapNutrition(scope, localEntries);
      if (generation !== nutritionGeneration.current || !isSameNutritionScope(scope, nutritionScopeRef.current)) {
        throw new Error('Профиль изменился во время синхронизации');
      }
      setNutritionMode(result.mode);
      if (result.products.length) setCatalog(result.products);
      if (editRevision === nutritionEditRevision.current) {
        setDiary({ scope, entries: result.entries, hydrated: true });
      }
      if (result.mode !== 'supabase') throw new Error(result.message ?? 'Не удалось подключить синхронизацию');
      return result;
    } finally {
      if (generation === nutritionGeneration.current) setNutritionConnecting(false);
    }
  }

  function openAuth(mode: PhoneAuthMode = 'signup') {
    setAuthGateMode(mode);
    setAuthGateOpen(true);
  }

  function refreshNutrition() {
    if (pullFeedbackTimer.current) window.clearTimeout(pullFeedbackTimer.current);
    setPullFeedback('refreshing');
    void connectNutrition().then(() => {
      setPullFeedback('updated');
      pullFeedbackTimer.current = window.setTimeout(() => setPullFeedback('idle'), 1800);
    }).catch(() => {
      setPullFeedback('error');
      pullFeedbackTimer.current = window.setTimeout(() => setPullFeedback('idle'), 2800);
    });
  }

  function startFoodPull(event: TouchEvent<HTMLDivElement>) {
    if (tab !== 'food' || nutritionConnecting || event.currentTarget.scrollTop > 0) return;
    pullStartY.current = event.touches[0]?.clientY ?? null;
  }

  function moveFoodPull(event: TouchEvent<HTMLDivElement>) {
    if (pullStartY.current === null || tab !== 'food' || event.currentTarget.scrollTop > 0) return;
    const distance = (event.touches[0]?.clientY ?? pullStartY.current) - pullStartY.current;
    if (distance <= 0) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }
    const nextDistance = Math.min(86, Math.round(distance * 0.46));
    pullDistanceRef.current = nextDistance;
    setPullDistance(nextDistance);
  }

  function endFoodPull() {
    const shouldRefresh = pullDistanceRef.current >= 62 && !nutritionConnecting && tab === 'food';
    pullStartY.current = null;
    pullDistanceRef.current = 0;
    setPullDistance(0);
    if (shouldRefresh) refreshNutrition();
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
    cacheAccount(nextAccount);
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
    setQuickAddMeal(meal);
    setQuickAddProduct(product);
    setQuickAddOpen(true);
  }

  async function openPreviousMeal(meal: MealKind) {
    const requestRevision = ++repeatRequestRevision.current;
    setRepeatLoadingMeal(meal);
    try {
      const previousEntries = await loadPreviousMealEntries(diary.scope, meal);
      if (requestRevision !== repeatRequestRevision.current) return;
      if (!previousEntries.length) {
        toast.add({
          title: `Предыдущий ${mealInSentence(meal)} не найден`,
          description: 'Когда появится история питания, FLUX предложит повторить её здесь.',
          type: 'info',
        });
        return;
      }
      setRepeatMeal(meal);
      setRepeatCandidates(previousEntries);
      setRepeatSelectedIds(new Set(previousEntries.map((entry) => entry.entryId)));
      setRepeatMealOpen(true);
    } finally {
      if (requestRevision === repeatRequestRevision.current) setRepeatLoadingMeal(null);
    }
  }

  function toggleRepeatedEntry(entryId: string) {
    setRepeatSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function toggleAllRepeatedEntries() {
    setRepeatSelectedIds((current) => current.size === repeatCandidates.length
      ? new Set()
      : new Set(repeatCandidates.map((entry) => entry.entryId)));
  }

  async function repeatPreviousMeal() {
    if (repeatSaving) return;
    const selected = repeatCandidates.filter((entry) => repeatSelectedIds.has(entry.entryId));
    if (!selected.length) return;
    const targetScope = diary.scope;
    setRepeatSaving(true);
    const now = new Date();
    const repeatedEntries = selected.map((entry, index): MealEntry => {
      const eatenAt = new Date(now.getTime() + index).toISOString();
      return {
        ...entry,
        entryId: crypto.randomUUID(),
        mealId: crypto.randomUUID(),
        meal: repeatMeal,
        eatenAt,
        time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(eatenAt)),
      };
    });

    if (!persistNewLocalEntries(targetScope, repeatedEntries)) {
      setRepeatSaving(false);
      toast.add({ title: 'Не удалось повторить приём пищи', description: 'Локальное хранилище недоступно.', type: 'error' });
      return;
    }

    nutritionEditRevision.current += 1;
    setEntries((current) => [...current, ...repeatedEntries]);
    setRepeatMealOpen(false);
    setRepeatSaving(false);
    toast.add({
      title: `${repeatMeal} добавлен`,
      description: `${repeatedEntries.length} ${productCountLabel(repeatedEntries.length)} · ${repeatedEntries.reduce((sum, entry) => sum + entry.kcal, 0)} ккал`,
      type: 'success',
    });

    if (nutritionMode === 'supabase') {
      void (async () => {
        try {
          for (const entry of repeatedEntries) {
            const synced = await addRemoteMealEntry(targetScope, entry);
            if (!synced) throw new Error('Не удалось синхронизировать запись');
          }
        } catch {
          setNutritionMode('local');
          toast.add({ title: 'Сохранено на устройстве', description: 'Повторённый приём синхронизируем после восстановления связи.', type: 'info' });
        }
      })();
    }
  }

  async function addProduct(product: Product, amount = product.amount, meal: MealKind = currentMeal()) {
    const scope = diary.scope;
    const productIsNewToCatalog = product.source !== 'nutriapix' && !catalog.some((candidate) => product.barcode
      ? candidate.barcode === product.barcode
      : candidate.id === product.id);
    const scale = amount / product.amount;
    const eatenAt = new Date().toISOString();
    const entry: MealEntry = {
      ...product,
      amount,
      kcal: Math.round(product.kcal * scale),
      protein: Math.round(product.protein * scale * 10) / 10,
      fat: Math.round(product.fat * scale * 10) / 10,
      carbs: Math.round(product.carbs * scale * 10) / 10,
      entryId: crypto.randomUUID(),
      mealId: crypto.randomUUID(),
      productId: product.source === 'nutriapix' ? null : product.id,
      meal,
      time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(eatenAt)),
      eatenAt,
    };

    if (!persistNewLocalEntry(scope, entry)) {
      toast.add({ title: 'Не удалось сохранить запись', description: 'Локальное хранилище недоступно. Попробуйте ещё раз.', type: 'error' });
      return;
    }
    const productWasStoredLocally = !productIsNewToCatalog || persistLocalProduct(scope, product);
    nutritionEditRevision.current += 1;
    if (scope.kind === 'guest') setGuestDiaryEntryCount(countGuestDiaryEntries());
    setEntries((current) => [...current, entry]);
    if (productIsNewToCatalog) {
      setCatalog((current) => current.some((candidate) => product.barcode
        ? candidate.barcode === product.barcode
        : candidate.id === product.id)
        ? current
        : [...current, product]);
    }

    if (nutritionMode === 'supabase') {
      try {
        await addRemoteMealEntry(scope, entry);
      } catch {
        setNutritionMode('local');
        toast.add({ title: 'Сохранили на устройстве', description: 'Supabase временно недоступен — запись не потеряется.', type: 'info' });
      }
    }

    toast.add({
      title: `Добавлено в ${mealInSentence(meal)}`,
      description: `${product.name} · ${amount} ${product.unit} · ${entry.kcal} ккал${productIsNewToCatalog && productWasStoredLocally ? ' · сохранили в каталог' : ''}`,
      type: 'success',
    });
  }

  async function updateEntry(entry: MealEntry, amount: number, meal: MealKind) {
    if (entrySaving || amount <= 0) return;
    const scope = diary.scope;
    const scale = amount / entry.amount;
    const nextEntry: MealEntry = {
      ...entry,
      amount,
      meal,
      kcal: Math.round(entry.kcal * scale),
      protein: Math.round(entry.protein * scale * 10) / 10,
      fat: Math.round(entry.fat * scale * 10) / 10,
      carbs: Math.round(entry.carbs * scale * 10) / 10,
    };
    const shouldQueueRemoteUpdate = isSupabaseConfigured && scope.kind === 'user';
    if (shouldQueueRemoteUpdate && !queueRemoteMealUpdate(scope, nextEntry)) {
      toast.add({ title: 'Не удалось сохранить изменения', description: 'Локальное хранилище недоступно. Попробуйте ещё раз.', type: 'error' });
      return;
    }
    if (!persistUpdatedLocalEntry(scope, nextEntry)) {
      toast.add({ title: 'Не удалось сохранить изменения', description: 'Локальное хранилище недоступно. Попробуйте ещё раз.', type: 'error' });
      return;
    }

    setEntrySaving(true);
    nutritionEditRevision.current += 1;
    setEntries((current) => current.map((candidate) => candidate.entryId === nextEntry.entryId ? nextEntry : candidate));
    setEditingEntry(null);

    if (nutritionMode === 'supabase') {
      try {
        await updateRemoteMealEntry(scope, nextEntry);
      } catch {
        setNutritionMode('local');
        toast.add({ title: 'Сохранили на устройстве', description: 'Изменения синхронизируем, когда Supabase снова станет доступен.', type: 'info' });
        setEntrySaving(false);
        return;
      }
    }

    setEntrySaving(false);
    toast.add({
      title: 'Продукт обновлён',
      description: `${nextEntry.name} · ${nextEntry.amount} ${nextEntry.unit} · ${nextEntry.kcal} ккал`,
      type: 'success',
    });
  }

  async function removeEntry(entry: MealEntry) {
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

    nutritionEditRevision.current += 1;
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
    ...(account?.isAdmin ? [{ id: 'admin' as const, label: 'Управление', icon: ShieldCheck }] : []),
  ];

  return (
    <Toaster>
      <main className="flux-stage" data-theme={fluxTheme}>
        <section className="flux-app-shell" aria-label="Приложение FLUX">
          {startupVisible ? <InitializationScreen /> : <>
          {!isOnline && <div className="flux-offline-pill" role="status"><WifiOff /> Офлайн · изменения сохраняются</div>}
          <div className="flux-base-app" aria-hidden={workoutOpen || profileOpen || undefined} inert={workoutOpen || profileOpen || undefined}>
            {tab === 'food' && <div className={`flux-pull-indicator${pullDistance > 0 || pullFeedback !== 'idle' ? ' is-visible' : ''}${pullDistance >= 62 ? ' is-ready' : ''}${pullFeedback === 'refreshing' ? ' is-refreshing' : ''}${pullFeedback === 'updated' ? ' is-updated' : ''}${pullFeedback === 'error' ? ' is-error' : ''}`} style={{ '--flux-pull-distance': `${pullDistance}px` } as CSSProperties} aria-live="polite">
              {pullFeedback === 'refreshing' ? <LoaderCircle className="is-spinning" /> : pullFeedback === 'updated' ? <Check /> : <RefreshCw />}
              <span>{pullFeedback === 'refreshing' ? 'Обновляем рацион…' : pullFeedback === 'updated' ? 'Рацион обновлён' : pullFeedback === 'error' ? 'Не удалось обновить' : pullDistance >= 62 ? 'Отпустите, чтобы обновить' : 'Потяните, чтобы обновить'}</span>
            </div>}
            <header key={`header-${tab}`} className={`flux-topbar${tab === 'today' || tab === 'food' || tab === 'workouts' || tab === 'progress' ? ' is-home' : ''}`}>
              <button className="flux-brand" type="button" onClick={() => setTab('today')} aria-label="FLUX — главная"><img className="flux-brand-lockup" src={`${import.meta.env.BASE_URL}brand/flux-lockup.png`} alt="" draggable="false" /></button>
              {(tab === 'today' || tab === 'food' || tab === 'workouts' || tab === 'progress') && <p className="flux-home-kicker">{tab === 'today' ? `Доброе утро${firstName ? `, ${firstName}` : ''}` : tab === 'food' ? 'Сегодня' : tab === 'workouts' ? 'План на сегодня' : 'Без давления'}</p>}
              <Button className="flux-avatar" variant="secondary" size="icon" onClick={openProfile} aria-label={account ? 'Открыть мой профиль' : 'Войти или зарегистрироваться'}>{account ? <><ProfileAvatar avatar={defaultAvatar} /><span className="flux-avatar-label">Мой профиль</span></> : '+'}</Button>
              {tab === 'today' && <h1 className="flux-home-title"><span>Сегодня достаточно</span><span>просто продолжить.</span></h1>}
              {tab === 'food' && <h1 className="flux-home-title"><span>Питание</span></h1>}
              {tab === 'workouts' && <h1 className="flux-home-title"><span>Тренировки</span></h1>}
              {tab === 'progress' && <h1 className="flux-home-title"><span>Прогресс</span></h1>}
            </header>
            <div
              key={tab}
              className="flux-content"
              id="top"
              onTouchStart={startFoodPull}
              onTouchMove={moveFoodPull}
              onTouchEnd={endFoodPull}
              onTouchCancel={endFoodPull}
            >
              {tab === 'today' && <TodayScreen totals={totals} target={calorieTarget} macroTargets={macroTargets} entries={entries} weekActivity={weekActivity} onEditBalance={openDailyBalance} />}
              {tab === 'food' && <FoodScreen entries={entries} target={calorieTarget} selectedDay={selectedNutritionDay} onSelectDay={setSelectedNutritionDay} historyLoading={historyLoading} mode={nutritionMode} isConnecting={nutritionConnecting} isAuthenticated={Boolean(account)} onAdd={(meal) => openFood(meal ?? currentMeal())} onEdit={setEditingEntry} onRemove={removeEntry} onRepeat={openPreviousMeal} repeatLoadingMeal={repeatLoadingMeal} />}
              {tab === 'workouts' && <WorkoutsScreen onStart={() => setWorkoutOpen(true)} />}
              {tab === 'progress' && <ProgressScreen />}
              {tab === 'admin' && account?.isAdmin && <AdminFeedbackScreen userId={account.id} />}
            </div>
            <nav className={`flux-bottom-nav${account?.isAdmin ? ' has-admin' : ''}`} aria-label="Основная навигация">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon /><span>{item.label}</span></button>; })}</nav>
          </div>
          {workoutOpen && <WorkoutFlow onClose={() => setWorkoutOpen(false)} />}
          {profileOpen && account && profileDraft && (
            <ProfileScreen
              account={account}
              avatar={defaultAvatar}
              draft={profileDraft}
              onAvatarChange={setDefaultAvatar}
              onChange={(nextDraft) => {
                profileEditRevision.current += 1;
                setProfileDraft(nextDraft);
              }}
              onClose={() => setProfileOpen(false)}
              onDone={completeProfile}
              onFeedback={() => { setProfileOpen(false); openFeedback('Профиль'); }}
              feedbackReplyCount={unreadFeedbackReplies}
              onSignOut={signOut}
              saving={profileSaving}
            />
          )}
          </>}
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
        syncsProducts={nutritionMode === 'supabase' && Boolean(account)}
        suggestionUserId={nutritionMode === 'supabase' ? account?.id ?? null : null}
      />
      <RepeatMealDrawer
        open={repeatMealOpen}
        meal={repeatMeal}
        entries={repeatCandidates}
        selectedIds={repeatSelectedIds}
        saving={repeatSaving}
        onOpenChange={setRepeatMealOpen}
        onToggle={toggleRepeatedEntry}
        onToggleAll={toggleAllRepeatedEntries}
        onConfirm={() => { void repeatPreviousMeal(); }}
      />
      <EditMealEntryDrawer
        open={Boolean(editingEntry)}
        entry={editingEntry}
        saving={entrySaving}
        onOpenChange={(open) => { if (!open && !entrySaving) setEditingEntry(null); }}
        onSave={(entry, amount, meal) => { void updateEntry(entry, amount, meal); }}
      />
      <DailyBalanceDrawer
        open={dailyBalanceOpen}
        draft={profileDraft}
        saving={profileSaving}
        onOpenChange={setDailyBalanceOpen}
        onSave={(nextDraft) => { void saveDailyBalance(nextDraft); }}
      />
      <PhonePasswordAuthGate
        guestDiaryEntryCount={guestDiaryEntryCount}
        initialMode={authGateMode}
        open={authGateOpen}
        onOpenChange={setAuthGateOpen}
        onAuthenticated={authenticate}
      />
      {account && <FeedbackDrawer open={feedbackOpen} onOpenChange={setFeedbackOpen} userId={account.id} screen={feedbackScreen} onRepliesRead={() => setUnreadFeedbackReplies(0)} onSubmitted={() => toast.add({ title: 'Спасибо за обратную связь', description: 'Обращение уже в очереди команды FLUX.', type: 'success' })} />}
    </Toaster>
  );
}
