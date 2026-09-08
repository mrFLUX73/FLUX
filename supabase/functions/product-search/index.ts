import * as cheerio from "cheerio";

const ALLOWED_ORIGINS = new Set([
  "https://mrflux73.github.io",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

const OFF_FIELDS = [
  "code",
  "product_name_ru",
  "product_name",
  "brands",
  "categories_tags",
  "product_quantity",
  "product_quantity_unit",
  "nutrition_data_per",
  "nutriments",
  "nutrition",
].join(",");

type Product = {
  id: string;
  barcode?: string;
  name: string;
  brand: string;
  amount: number;
  unit: "г" | "мл";
  servingSizeG: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  icon: "wheat" | "curd" | "banana" | "coffee";
  source?: "nutriapix";
  externalFoodId?: string;
  externalBrandId?: string;
  externalServingId?: string;
};

type SearchResult =
  | { status: "found"; product: Product; source: "Nutriapix" | "Open Food Facts" | "FatSecret" }
  | { status: "incomplete"; name: string }
  | { status: "not_found" }
  | { status: "error"; message: string };

type NutriapixCandidate = { source: "nutriapix"; name: string; brand: string; slug: string };
type OpenFoodFactsCandidate = { source: "open_food_facts"; name: string; brand: string; product: Product };
type FatSecretCandidate = { source: "fatsecret"; name: string; brand: string; product: Product };
type NutriapixSearchResult =
  | { status: "found"; candidates: NutriapixCandidate[] }
  | { status: "not_found" }
  | { status: "error"; message: string };
type NameSearchResult =
  | { status: "found"; candidates: Array<NutriapixCandidate | OpenFoodFactsCandidate | FatSecretCandidate> }
  | { status: "not_found" }
  | { status: "error"; message: string };
type NutriapixFoodResult =
  | { status: "found"; product: Product }
  | { status: "not_found" }
  | { status: "error"; message: string };
type FunctionResult = SearchResult | NameSearchResult | NutriapixFoodResult;
type CachedNutriapixFood = { expiresAt: number; result: NutriapixFoodResult };
const nutriapixFoodCache = new Map<string, CachedNutriapixFood>();
const NUTRIAPIX_CACHE_MS = 24 * 60 * 60 * 1000;

type NameCandidate = { name: string; rating: number };
type FatSecretHit = {
  name: string;
  brand: string;
  serving: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  score: number;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://mrflux73.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: FunctionResult | { error: string }, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function offNutrient(source: Record<string, unknown>, name: string) {
  const nutrition = source.nutrition as Record<string, unknown> | undefined;
  const aggregate = nutrition?.aggregated_set as Record<string, unknown> | undefined;
  const nutrients = aggregate?.nutrients as Record<string, unknown> | undefined;
  const v3 = nutrients?.[name] as Record<string, unknown> | undefined;
  const legacy = source.nutriments as Record<string, unknown> | undefined;
  return numeric(v3?.value) ?? numeric(v3?.value_computed) ?? numeric(legacy?.[`${name}_100g`]);
}

function offNutritionPer(source: Record<string, unknown>) {
  const nutrition = source.nutrition as Record<string, unknown> | undefined;
  const aggregate = nutrition?.aggregated_set as Record<string, unknown> | undefined;
  return text(aggregate?.per) || text(source.nutrition_data_per);
}

async function fetchWithTimeout(url: string, timeoutMs: number, headers: HeadersInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "Accept-Language": "ru-RU,ru;q=0.9",
        "User-Agent": "FLUX/0.1 product lookup",
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function productIcon(text: string): Product["icon"] {
  const normalized = text.toLocaleLowerCase("ru");
  if (/напит|сок|вода|чай|кофе/.test(normalized)) return "coffee";
  if (/фрукт|овощ|яблок|банан/.test(normalized)) return "banana";
  if (/круп|каша|рис|греч|зерн/.test(normalized)) return "wheat";
  return "curd";
}

function packageSize(text: string): { amount: number; unit: "г" | "мл" } {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(кг|г|гр|мл|л)(?![а-яёa-z])/iu);
  if (!match) return { amount: 100, unit: "г" };
  let amount = Number(match[1].replace(",", "."));
  const rawUnit = match[2].toLocaleLowerCase("ru");
  if (rawUnit === "кг" || rawUnit === "л") amount *= 1000;
  return { amount, unit: rawUnit === "мл" || rawUnit === "л" ? "мл" : "г" };
}

async function lookupOpenFoodFacts(barcode: string): Promise<SearchResult> {
  try {
    const url = `https://world.openfoodfacts.org/api/v3.6/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
    const response = await fetchWithTimeout(url, 6500, { Accept: "application/json" });
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "error", message: `Open Food Facts: HTTP ${response.status}` };
    const payload = await response.json();
    const source = payload?.status === 1 ? payload.product : null;
    if (!source) return { status: "not_found" };

    const name = String(source.product_name_ru || source.product_name || "").trim();
    const kcal = offNutrient(source, "energy-kcal");
    const protein = offNutrient(source, "proteins");
    const fat = offNutrient(source, "fat");
    const carbs = offNutrient(source, "carbohydrates");
    if (!name || kcal === null || protein === null || fat === null || carbs === null) {
      return { status: "incomplete", name: name || `Товар ${barcode}` };
    }

    const size = packageSize(`${source.product_quantity ?? ""} ${source.product_quantity_unit ?? ""}`);
    const isLiquid = size.unit === "мл" || offNutritionPer(source) === "100ml"
      || /beverage|drink|напит/.test((source.categories_tags ?? []).join(" ").toLocaleLowerCase("ru"));
    const portion = { amount: size.amount, unit: isLiquid ? "мл" as const : "г" as const };
    const scale = portion.amount / 100;
    return {
      status: "found",
      source: "Open Food Facts",
      product: {
        id: `open-food-facts:${barcode}`,
        barcode,
        name,
        brand: String(source.brands || "Без бренда").trim(),
        amount: rounded(portion.amount),
        unit: portion.unit,
        servingSizeG: rounded(portion.amount),
        kcal: Math.round(kcal * scale),
        protein: rounded(protein * scale),
        fat: rounded(fat * scale),
        carbs: rounded(carbs * scale),
        icon: productIcon(`${name} ${(source.categories_tags ?? []).join(" ")}`),
      },
    };
  } catch {
    return { status: "error", message: "Open Food Facts недоступен" };
  }
}

function openFoodFactsProduct(source: Record<string, unknown>, barcode: string): Product | null {
  const name = text(source.product_name_ru) || text(source.product_name);
  const kcal = offNutrient(source, "energy-kcal");
  const protein = offNutrient(source, "proteins");
  const fat = offNutrient(source, "fat");
  const carbs = offNutrient(source, "carbohydrates");
  if (!name || kcal === null || protein === null || fat === null || carbs === null) return null;
  const size = packageSize(`${text(source.product_quantity)} ${text(source.product_quantity_unit)}`);
  const categories = Array.isArray(source.categories_tags) ? source.categories_tags.join(" ") : "";
  const isLiquid = size.unit === "мл" || offNutritionPer(source) === "100ml" || /beverage|drink|напит/iu.test(categories);
  const portion = { amount: size.amount, unit: isLiquid ? "мл" as const : "г" as const };
  const scale = portion.amount / 100;
  return {
    id: `open-food-facts:${barcode}`,
    barcode,
    name,
    brand: text(source.brands) || "Без бренда",
    amount: rounded(portion.amount),
    unit: portion.unit,
    servingSizeG: rounded(portion.amount),
    kcal: Math.round(kcal * scale),
    protein: rounded(protein * scale),
    fat: rounded(fat * scale),
    carbs: rounded(carbs * scale),
    icon: productIcon(`${name} ${categories}`),
  };
}

async function searchOpenFoodFacts(query: string): Promise<OpenFoodFactsCandidate[]> {
  try {
    const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "8");
    url.searchParams.set("fields", OFF_FIELDS);
    const response = await fetchWithTimeout(url.toString(), 6500, { Accept: "application/json" });
    if (!response.ok) return [];
    const payload = await response.json() as { products?: unknown };
    const rows = Array.isArray(payload.products) ? payload.products : [];
    return rows.flatMap((row): OpenFoodFactsCandidate[] => {
      if (!row || typeof row !== "object") return [];
      const source = row as Record<string, unknown>;
      const barcode = text(source.code);
      if (!barcode) return [];
      const product = openFoodFactsProduct(source, barcode);
      return product ? [{ source: "open_food_facts", name: product.name, brand: product.brand, product }] : [];
    });
  } catch {
    return [];
  }
}

function hasLetters(value: string) {
  return /[a-zа-яё]/iu.test(value);
}

function nameQuality(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(words, 8) + (/\d+[.,]?\d*\s*(кг|гр|г|мл|л)(?![а-яёa-z])/iu.test(name) ? 3 : 0);
}

async function lookupBarcodeName(barcode: string): Promise<string | null> {
  try {
    const url = new URL("/barcode/RU/Поиск.htm", "https://barcode-list.ru");
    url.searchParams.set("barcode", barcode);
    const response = await fetchWithTimeout(url.toString(), 6500);
    if (!response.ok) return null;
    const $ = cheerio.load(await response.text());
    const candidates: NameCandidate[] = [];
    $("table.randomBarcodes tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 5) return;
      const rowBarcode = $(cells[1]).text().replace(/\D/g, "");
      const name = $(cells[2]).text().replace(/\s+/g, " ").trim();
      const rating = Number($(cells[4]).text().trim()) || 0;
      if (rowBarcode === barcode && name && hasLetters(name)) candidates.push({ name, rating });
    });
    const multiword = candidates.filter((candidate) => candidate.name.trim().split(/\s+/).length > 1);
    const pool = multiword.length ? multiword : candidates;
    return pool.sort((a, b) => (b.rating * 100 + nameQuality(b.name)) - (a.rating * 100 + nameQuality(a.name)))[0]?.name ?? null;
  } catch {
    return null;
  }
}

const UNIT_WORDS = new Set(["шт", "кг", "г", "гр", "мл", "л", "уп", "пач", "бан", "бут", "п", "кор"]);

function cleanNameVariants(raw: string): string[] {
  const cleaned = raw
    .replace(/(?<![\p{L}\d])\d+[.,]?\d*\s*(кг|гр|мл|шт|уп|пач|бан|бут|кор|л|п|г)\.?(?=\s|$)/giu, " ")
    .replace(/[«»"“”'']/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !UNIT_WORDS.has(token.toLocaleLowerCase("ru").replace(/\.$/, "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean).map((token) => token.toLocaleLowerCase("ru"));
  if (!tokens.length) return [];
  if (tokens.length === 1) return [tokens[0]];
  const [type, brand, ...description] = tokens;
  return [...new Set([
    [brand, type, ...description].join(" "),
    [type, ...description].join(" "),
    [brand, type].join(" "),
  ])].slice(0, 3);
}

function tokens(text: string) {
  return text.toLocaleLowerCase("ru").replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1) ?? [];
}

function percent(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/u);
  if (match) return Number(match[1].replace(",", "."));
  // Barcode-List sometimes drops the percent sign but keeps the decimal
  // fat value, for example "ТВОРОГ ... 0.3 180Г". A package size has a
  // unit suffix and cannot be mistaken for this standalone decimal.
  const decimal = text.match(/(?:^|\s)(\d+[.,]\d+)(?=\s|$)/u);
  return decimal ? Number(decimal[1].replace(",", ".")) : null;
}

function matchScore(original: string, name: string, brand: string) {
  const expectedPercent = percent(original);
  const foundPercent = percent(`${name} ${brand}`);
  if (expectedPercent !== null && foundPercent !== null && Math.abs(expectedPercent - foundPercent) > 0.11) return -100;

  const expected = new Set(tokens(original));
  const found = new Set(tokens(`${name} ${brand}`));
  let overlap = 0;
  for (const token of expected) if (found.has(token)) overlap += 1;
  const ratio = expected.size ? overlap / expected.size : 0;
  let score = ratio * 100;
  if (/обезжир/iu.test(original) && !/обезжир/iu.test(`${name} ${brand}`)) score -= 35;
  if (expectedPercent !== null && foundPercent === expectedPercent) score += 35;
  return score;
}

function parseNutrition(text: string) {
  const servingMatch = text.match(/^в\s+(.+?)\s*-\s*(.+)$/iu);
  if (!servingMatch) return null;
  const read = (pattern: RegExp) => numeric(servingMatch[2].match(pattern)?.[1]);
  const kcal = read(/калори[а-я]*\s*:\s*([\d,.]+)/iu);
  const fat = read(/жир\s*:\s*([\d,.]+)/iu);
  const carbs = read(/углев[а-я]*\s*:\s*([\d,.]+)/iu);
  const protein = read(/белк[а-я]*\s*:\s*([\d,.]+)/iu);
  if (kcal === null || fat === null || carbs === null || protein === null) return null;
  return { serving: servingMatch[1].trim(), kcal, protein, fat, carbs };
}

async function searchFatSecretWeb(query: string, original: string): Promise<FatSecretHit[]> {
  try {
    const url = `http://www.fatsecret.ru/калории-питание/search?q=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) return [];
    const $ = cheerio.load(await response.text());
    const hits: FatSecretHit[] = [];
    $("table.searchResult tr td.borderBottom, table.generic.searchResult tr td.borderBottom").each((_, element) => {
      const cell = $(element);
      const name = cell.find("a.prominent").first().text().trim();
      const brand = cell.find("a.brand").first().text().replace(/[()]/g, "").trim();
      const details = cell.find("div.smallText.greyText.greyLink").first().text().replace(/\s+/g, " ").trim();
      const nutrition = parseNutrition(details);
      if (!name || !nutrition) return;
      hits.push({ ...nutrition, name, brand, score: matchScore(original, name, brand) });
    });
    return hits;
  } catch {
    return [];
  }
}

function oauthEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function base64(bytes: ArrayBuffer) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text);
}

async function fatSecretSignature(method: string, endpoint: string, parameters: Record<string, string>, consumerSecret: string) {
  const normalized = Object.entries(parameters)
    .map(([key, value]) => [oauthEncode(key), oauthEncode(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const base = `${method.toUpperCase()}&${oauthEncode(endpoint)}&${oauthEncode(normalized)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${oauthEncode(consumerSecret)}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)));
}

function parseFatSecretApiDescription(description: string) {
  const servingMatch = description.match(/^per\s+(.+?)\s*-\s*(.+)$/iu);
  if (!servingMatch) return null;
  const read = (pattern: RegExp) => numeric(servingMatch[2].match(pattern)?.[1]);
  const kcal = read(/calories\s*:\s*([\d,.]+)/iu);
  const fat = read(/fat\s*:\s*([\d,.]+)/iu);
  const carbs = read(/carbs\s*:\s*([\d,.]+)/iu);
  const protein = read(/protein\s*:\s*([\d,.]+)/iu);
  if (kcal === null || fat === null || carbs === null || protein === null) return null;
  return { serving: servingMatch[1].trim(), kcal, protein, fat, carbs };
}

async function searchFatSecretApi(query: string, original: string): Promise<FatSecretHit[]> {
  const consumerKey = Deno.env.get("FATSECRET_CONSUMER_KEY");
  const consumerSecret = Deno.env.get("FATSECRET_CONSUMER_SECRET");
  if (!consumerKey || !consumerSecret) return [];
  try {
    const endpoint = "https://platform.fatsecret.com/rest/foods/search/v1";
    const parameters: Record<string, string> = {
      format: "json",
      max_results: "8",
      oauth_consumer_key: consumerKey,
      oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_version: "1.0",
      page_number: "0",
      search_expression: query,
    };
    parameters.oauth_signature = await fatSecretSignature("GET", endpoint, parameters, consumerSecret);
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const response = await fetchWithTimeout(url.toString(), 6500, { Accept: "application/json" });
    if (!response.ok) return [];
    const payload = await response.json() as { foods?: { food?: unknown } };
    const foods = Array.isArray(payload.foods?.food) ? payload.foods.food : [payload.foods?.food].filter(Boolean);
    return foods.flatMap((food): FatSecretHit[] => {
      if (!food || typeof food !== "object") return [];
      const row = food as Record<string, unknown>;
      const name = text(row.food_name);
      const nutrition = parseFatSecretApiDescription(text(row.food_description));
      if (!name || !nutrition) return [];
      const brand = text(row.brand_name);
      return [{ ...nutrition, name, brand, score: matchScore(original, name, brand) }];
    });
  } catch {
    return [];
  }
}

async function lookupFatSecret(barcode: string, rawName: string): Promise<SearchResult> {
  const variants = cleanNameVariants(rawName);
  if (!variants.length) return { status: "incomplete", name: rawName };
  // The official API is attempted first. Its free plan has a US-only catalogue,
  // so the public Russian search remains a compatibility fallback rather than
  // making existing Russian barcode results disappear.
  const apiGroups = await Promise.all(variants.map((query) => searchFatSecretApi(query, rawName)));
  let best = apiGroups.flat().filter((hit) => hit.score >= 45).sort((a, b) => b.score - a.score)[0];
  if (!best) {
    const webGroups = await Promise.all(variants.map((query) => searchFatSecretWeb(query, rawName)));
    best = webGroups.flat().filter((hit) => hit.score >= 45).sort((a, b) => b.score - a.score)[0];
  }
  if (!best) return { status: "incomplete", name: rawName };

  const serving = packageSize(best.serving);
  const scaleTo100 = serving.amount > 0 ? 100 / serving.amount : 1;
  const per100 = {
    kcal: best.kcal * scaleTo100,
    protein: best.protein * scaleTo100,
    fat: best.fat * scaleTo100,
    carbs: best.carbs * scaleTo100,
  };
  const portion = packageSize(rawName);
  const portionScale = portion.amount / 100;
  return {
    status: "found",
    source: "FatSecret",
    product: {
      id: `fatsecret:${barcode}`,
      barcode,
      name: best.name,
      brand: best.brand || "Без бренда",
      amount: rounded(portion.amount),
      unit: portion.unit,
      servingSizeG: rounded(portion.amount),
      kcal: Math.round(per100.kcal * portionScale),
      protein: rounded(per100.protein * portionScale),
      fat: rounded(per100.fat * portionScale),
      carbs: rounded(per100.carbs * portionScale),
      icon: productIcon(`${best.name} ${best.brand}`),
    },
  };
}

function fatSecretProduct(hit: FatSecretHit, key: string): Product {
  const serving = packageSize(hit.serving);
  const scaleTo100 = serving.amount > 0 ? 100 / serving.amount : 1;
  const portionScale = serving.amount / 100;
  const normalized = `${hit.name}|${hit.brand}|${hit.serving}`.toLocaleLowerCase("ru");
  return {
    id: `fatsecret:search:${encodeURIComponent(`${key}|${normalized}`)}`,
    name: hit.name,
    brand: hit.brand || "Без бренда",
    amount: rounded(serving.amount),
    unit: serving.unit,
    servingSizeG: rounded(serving.amount),
    kcal: Math.round(hit.kcal * scaleTo100 * portionScale),
    protein: rounded(hit.protein * scaleTo100 * portionScale),
    fat: rounded(hit.fat * scaleTo100 * portionScale),
    carbs: rounded(hit.carbs * scaleTo100 * portionScale),
    icon: productIcon(`${hit.name} ${hit.brand}`),
  };
}

async function searchFatSecretByName(query: string): Promise<FatSecretCandidate[]> {
  // The official API is primary. The Russian public catalogue remains a
  // compatibility source: it is the catalogue familiar to FLUX's Russian users
  // and often has products which the official free API does not return.
  const variants = [...new Set([query, ...cleanNameVariants(query)])].slice(0, 4);
  const [apiGroups, webGroups] = await Promise.all([
    Promise.all(variants.map((variant) => searchFatSecretApi(variant, query))),
    Promise.all(variants.map((variant) => searchFatSecretWeb(variant, query))),
  ]);
  const unique = new Map<string, FatSecretHit>();
  for (const hit of [...apiGroups.flat(), ...webGroups.flat()]) {
    if (hit.score < 45) continue;
    const key = `${hit.name}|${hit.brand}|${hit.serving}`.toLocaleLowerCase("ru");
    const prior = unique.get(key);
    if (!prior || hit.score > prior.score) unique.set(key, hit);
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((hit) => ({ source: "fatsecret" as const, name: hit.name, brand: hit.brand || "Без бренда", product: fatSecretProduct(hit, query) }));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nutriapixNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nutriapixServing(food: Record<string, unknown>) {
  const servings = Array.isArray(food.servings) ? food.servings.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const source = servings.find((serving) => serving.is_default === true) ?? servings[0];
  const amount = nutriapixNumber(source?.metric_serving_amount) ?? 100;
  const rawUnit = text(source?.metric_serving_unit).toLocaleLowerCase("ru");
  const isLiquid = /мл|ml|миллилитр/.test(rawUnit)
    || /напит|beverage|drink/.test(text(food.category).toLocaleLowerCase("ru"));
  return {
    amount: rounded(amount),
    unit: isLiquid ? "мл" as const : "г" as const,
    servingSizeG: rounded(amount),
    servingId: text(source?.serving_id),
  };
}

async function nutriapixFetch(path: string) {
  const apiKey = Deno.env.get("NUTRIAPIX_API_KEY");
  if (!apiKey) throw new Error("Ключ Nutriapix не настроен на сервере.");
  return fetchWithTimeout(`https://nutriapix.ru/api/v1${path}`, 6500, {
    Accept: "application/json",
    "NUTRIAPIX-API-KEY": apiKey,
  });
}

async function searchNutriapix(query: string): Promise<NutriapixSearchResult> {
  try {
    const url = new URL("https://nutriapix.ru/api/v1/food/search");
    url.searchParams.set("q", query);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "8");
    const apiKey = Deno.env.get("NUTRIAPIX_API_KEY");
    if (!apiKey) return { status: "error", message: "Ключ Nutriapix не настроен на сервере." };
    const response = await fetchWithTimeout(url.toString(), 6500, { Accept: "application/json", "NUTRIAPIX-API-KEY": apiKey });
    if (response.status === 404) return { status: "not_found" };
    if (response.status === 429) return { status: "error", message: "Nutriapix временно ограничил частоту поиска. Попробуйте чуть позже." };
    if (!response.ok) return { status: "error", message: `Nutriapix временно недоступен (HTTP ${response.status}).` };
    const payload = await response.json() as Record<string, unknown>;
    const rows = Array.isArray(payload.results) ? payload.results : [];
    const candidates = rows.flatMap((row): NutriapixCandidate[] => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const name = text(record.food_name);
      const slug = text(record.food_slug);
      return name && slug ? [{ source: "nutriapix", name, slug, brand: text(record.food_brand) || "Без бренда" }] : [];
    });
    return candidates.length ? { status: "found", candidates } : { status: "not_found" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Не удалось связаться с Nutriapix." };
  }
}

function nameSearchScore(query: string, candidate: { name: string; brand: string }) {
  const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(candidate.name);
  const queryTokens = new Set(tokens(normalizedQuery));
  const candidateTokens = new Set(tokens(`${normalizedName} ${candidate.brand}`));
  let overlap = 0;
  for (const token of queryTokens) if (candidateTokens.has(token)) overlap += 1;
  return (normalizedName === normalizedQuery ? 1000 : normalizedName.includes(normalizedQuery) ? 500 : 0) + overlap * 50;
}

async function searchByName(query: string): Promise<NameSearchResult> {
  const [nutriapix, openFoodFacts, fatSecret] = await Promise.all([
    searchNutriapix(query),
    searchOpenFoodFacts(query),
    searchFatSecretByName(query),
  ]);
  const candidates = [
    ...openFoodFacts,
    ...(nutriapix.status === "found" ? nutriapix.candidates : []),
    ...fatSecret,
  ]
    .sort((left, right) => nameSearchScore(query, right) - nameSearchScore(query, left))
    .slice(0, 8);
  if (candidates.length) return { status: "found", candidates };
  if (nutriapix.status === "error") return nutriapix;
  return { status: "not_found" };
}

function nutriapixFoodResult(food: Record<string, unknown>, barcode?: string): NutriapixFoodResult {
  const kcal = nutriapixNumber((food.nutritions as Record<string, unknown> | undefined)?.calories);
  const protein = nutriapixNumber(((food.nutritions as Record<string, unknown> | undefined)?.protein as Record<string, unknown> | undefined)?.total_protein);
  const fat = nutriapixNumber(((food.nutritions as Record<string, unknown> | undefined)?.fat as Record<string, unknown> | undefined)?.total_fat);
  const carbs = nutriapixNumber(((food.nutritions as Record<string, unknown> | undefined)?.carbohydrate as Record<string, unknown> | undefined)?.total_carbohydrate);
  const name = text(food.food_name);
  const foodId = text(food.food_id);
  if (!name || !foodId || kcal === null || protein === null || fat === null || carbs === null) {
    return { status: "error", message: "В карточке Nutriapix не хватает полного КБЖУ." };
  }
  const serving = nutriapixServing(food);
  const scale = serving.servingSizeG / 100;
  return { status: "found", product: {
    id: `nutriapix:${foodId}`,
    ...(barcode ? { barcode } : {}),
    name,
    brand: text(food.brand_name) || "Без бренда",
    amount: serving.amount,
    unit: serving.unit,
    servingSizeG: serving.servingSizeG,
    kcal: Math.round(kcal * scale),
    protein: rounded(protein * scale),
    fat: rounded(fat * scale),
    carbs: rounded(carbs * scale),
    icon: productIcon(`${name} ${text(food.category)}`),
    source: "nutriapix",
    externalFoodId: foodId,
    externalBrandId: text(food.brand_id),
    externalServingId: serving.servingId,
  }};
}

async function getNutriapixFood(cacheKey: string, path: string, barcode?: string): Promise<NutriapixFoodResult> {
  const cached = nutriapixFoodCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  nutriapixFoodCache.delete(cacheKey);
  let result: NutriapixFoodResult;
  try {
    const response = await nutriapixFetch(path);
    if (response.status === 404) result = { status: "not_found" };
    else if (response.status === 429) result = { status: "error", message: "Nutriapix временно ограничил запросы карточек. Попробуйте чуть позже." };
    else if (!response.ok) result = { status: "error", message: `Nutriapix временно недоступен (HTTP ${response.status}).` };
    else result = nutriapixFoodResult(await response.json() as Record<string, unknown>, barcode);
  } catch (error) {
    result = { status: "error", message: error instanceof Error ? error.message : "Не удалось связаться с Nutriapix." };
  }
  nutriapixFoodCache.set(cacheKey, { result, expiresAt: Date.now() + NUTRIAPIX_CACHE_MS });
  return result;
}

function getNutriapixFoodBySlug(slug: string) {
  return getNutriapixFood(`slug:${slug}`, `/food?slug=${encodeURIComponent(slug)}`);
}

async function lookupNutriapixBarcode(barcode: string): Promise<SearchResult> {
  const result = await getNutriapixFood(`barcode:${barcode}`, `/food?barcode=${encodeURIComponent(barcode)}`, barcode);
  if (result.status === "found") return { status: "found", source: "Nutriapix", product: result.product };
  if (result.status === "error") return result;
  return { status: "not_found" };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

  let payload: Record<string, unknown> = {};
  try {
    const body = await request.json();
    payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return json(request, { error: "Некорректный JSON" }, 400);
  }
  if (payload.mode === "name-search" || payload.mode === "nutriapix-search") {
    const query = text(payload.query);
    if (query.length < 3 || query.length > 100) return json(request, { error: "Введите от 3 до 100 символов для поиска" }, 400);
    return json(request, await searchByName(query));
  }
  if (payload.mode === "nutriapix-food") {
    const slug = text(payload.slug);
    if (slug.length < 3 || slug.length > 100) return json(request, { error: "Некорректный идентификатор продукта" }, 400);
    return json(request, await getNutriapixFoodBySlug(slug));
  }
  const barcode = String(payload.barcode ?? "").replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(barcode)) return json(request, { error: "Некорректный штрихкод" }, 400);

  const nutriapixPromise = lookupNutriapixBarcode(barcode);
  const offPromise = lookupOpenFoodFacts(barcode);
  const namePromise = lookupBarcodeName(barcode);
  const [nutriapix, off] = await Promise.all([nutriapixPromise, offPromise]);
  if (nutriapix.status === "found") return json(request, nutriapix);
  if (off.status === "found") return json(request, off);

  const rawName = await namePromise;
  if (rawName) return json(request, await lookupFatSecret(barcode, rawName));
  if (off.status === "incomplete") return json(request, off);
  if (off.status === "error") return json(request, off, 503);
  return json(request, { status: "not_found" });
});
