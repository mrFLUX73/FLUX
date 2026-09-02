# FLUX

Светлое мобильное приложение для спокойного учёта питания и домашних тренировок.

## Что уже работает

- главная с дневным балансом КБЖУ;
- быстрое добавление привычных продуктов;
- поиск продукта и выбор порции;
- выбор приёма пищи и сгруппированный дневник;
- сохранение дневника на устройстве с готовой синхронизацией Supabase;
- интерактивная тренировка с таймером подхода и отдыхом;
- экран прогресса;
- адаптивная мобильная оболочка;
- схема Supabase с RLS;
- автоматическая публикация на GitHub Pages.

Без переменных Supabase приложение работает локально и сохраняет дневник в браузере. После безопасного включения анонимного входа оно создаёт сессию, загружает общий каталог и синхронизирует дневник с защищённой базой.

## Запуск

```bash
pnpm install
pnpm dev
```

Проверка production-сборки:

```bash
pnpm build
pnpm preview
```

## Supabase

1. Создайте проект Supabase.
2. Включите **Anonymous Sign-Ins** и настройте CAPTCHA/Turnstile по инструкции Supabase.
3. Скопируйте `.env.example` в `.env.local`, заполните URL и publishable key, затем установите `VITE_SUPABASE_ANONYMOUS_AUTH_ENABLED=true`.
4. Примените обе миграции из `supabase/migrations` командой `supabase db push`.

Подробности находятся в `docs/supabase.md`.

## GitHub Pages

Workflow `.github/workflows/deploy.yml` публикует папку `dist` после каждого push в ветку `main`. В настройках репозитория GitHub выберите **Pages → Source → GitHub Actions**, а в **Settings → Secrets and variables → Actions → Variables** добавьте `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` и, только после настройки защиты, `VITE_SUPABASE_ANONYMOUS_AUTH_ENABLED=true`.
