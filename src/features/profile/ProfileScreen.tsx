import { ArrowLeft, CalendarDays, Check, ChevronDown, LogOut, MessageCircle, Pill } from 'lucide-react';
import { useState, type CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { FluxAccount } from '../auth/phonePasswordAuth';

export type DefaultAvatar = 'short-hair' | 'bun';
export type FluxTheme = 'sage' | 'storm' | 'ocean' | 'bloom' | 'sand' | 'night';

export type ProfileDraft = {
  displayName: string;
  theme: FluxTheme;
  birthDate: string;
  calculationSex: '' | 'female' | 'male';
  heightCm: string;
  currentWeightKg: string;
  goal: '' | 'lose' | 'maintain' | 'gain';
  targetWeightKg: string;
  paceKgPerWeek: '' | '0.25' | '0.5' | '0.75';
  dailyCalories: string;
  dailyProteinG: string;
  dailyFatG: string;
  dailyCarbsG: string;
  activity: '' | 'low' | 'medium' | 'high';
  workoutsPerWeek: string;
  motivationCapsule: string;
};

export function createProfileDraft(account: FluxAccount): ProfileDraft {
  return {
    displayName: account.displayName,
    theme: 'sage',
    birthDate: '',
    calculationSex: '',
    heightCm: '',
    currentWeightKg: '',
    goal: 'lose',
    targetWeightKg: '',
    paceKgPerWeek: '0.5',
    dailyCalories: '2000',
    dailyProteinG: '110',
    dailyFatG: '70',
    dailyCarbsG: '230',
    activity: '',
    workoutsPerWeek: '',
    motivationCapsule: '',
  };
}

const sexOptions: { sex: Exclude<ProfileDraft['calculationSex'], ''>; avatar: DefaultAvatar; label: string }[] = [
  { sex: 'male', avatar: 'short-hair', label: 'Мужской' },
  { sex: 'female', avatar: 'bun', label: 'Женский' },
];

export const fluxThemes: {
  id: FluxTheme;
  label: string;
  description: string;
  colors: [string, string, string];
}[] = [
  { id: 'sage', label: 'Sage', description: 'Фирменная зелёная', colors: ['#fbfdf9', '#e3efdd', '#365f3b'] },
  { id: 'storm', label: 'Storm', description: 'Спокойная серая', colors: ['#f8f9f8', '#e2e7e8', '#465158'] },
  { id: 'ocean', label: 'Ocean', description: 'Глубокая синяя', colors: ['#f9fcfc', '#dcebea', '#315f66'] },
  { id: 'bloom', label: 'Bloom', description: 'Мягкая пудровая', colors: ['#fdfafb', '#f0e2e8', '#775268'] },
  { id: 'sand', label: 'Sand', description: 'Тёплая бежевая', colors: ['#fdfbf7', '#efe6d4', '#6f5d42'] },
  { id: 'night', label: 'Night', description: 'Тёмная и спокойная', colors: ['#121816', '#24342a', '#7fc38e'] },
];

export function isFluxTheme(value: unknown): value is FluxTheme {
  return fluxThemes.some((theme) => theme.id === value);
}

export function defaultThemeForSex(sex: ProfileDraft['calculationSex']): FluxTheme {
  if (sex === 'male') return 'ocean';
  if (sex === 'female') return 'bloom';
  return 'sage';
}

export function ProfileAvatar({ avatar, label }: { avatar: DefaultAvatar; label?: string }) {
  const style = {
    '--flux-avatar-mask': `url("${import.meta.env.BASE_URL}avatars/avatar-${avatar}-mask.png")`,
  } as CSSProperties;
  return <span className="flux-avatar-art" style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 11) return 'Номер сохранён приватно';
  return `+7 ••• •••-${digits.slice(-4, -2)}-${digits.slice(-2)}`;
}

function formatBirthDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Выберите дату';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0';
const buildRun = import.meta.env.VITE_BUILD_RUN;
const buildSha = import.meta.env.VITE_BUILD_SHA;
const buildAt = import.meta.env.VITE_BUILD_AT;

function formatBuildTime(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  }).format(date);
}

function ProfileField({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return <label className={`flux-profile-field${wide ? ' is-wide' : ''}`}><span>{label}</span>{children}</label>;
}

function ProfileAccordion({
  eyebrow,
  title,
  children,
  defaultOpen = false,
  icon,
  className = '',
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`flux-profile-card flux-profile-accordion${open ? ' is-open' : ''} ${className}`}>
      <button className="flux-profile-accordion-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{icon}<i><small>{eyebrow}</small><strong>{title}</strong></i></span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && <div className="flux-profile-accordion-body">{children}</div>}
    </section>
  );
}

export function ProfileScreen({
  account,
  avatar,
  draft,
  onAvatarChange,
  onChange,
  onClose,
  onDone,
  onFeedback,
  feedbackReplyCount,
  onSignOut,
  saving,
}: {
  account: FluxAccount;
  avatar: DefaultAvatar;
  draft: ProfileDraft;
  onAvatarChange: (avatar: DefaultAvatar) => void;
  onChange: (draft: ProfileDraft) => void;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  onFeedback: () => void;
  feedbackReplyCount: number;
  onSignOut: () => Promise<void> | void;
  saving: boolean;
}) {
  const [buildInfoOpen, setBuildInfoOpen] = useState(false);
  const set = <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => {
    onChange({ ...draft, [key]: value });
  };
  const requiredValues = [
    draft.displayName,
    draft.birthDate,
    draft.calculationSex,
    draft.heightCm,
    draft.currentWeightKg,
    draft.goal,
    draft.activity,
    draft.workoutsPerWeek,
    ...(draft.goal && draft.goal !== 'maintain' ? [draft.targetWeightKg, draft.paceKgPerWeek] : []),
  ];
  const completed = requiredValues.filter(Boolean).length;
  const completeness = Math.round((completed / requiredValues.length) * 100);
  const selectedAvatar = sexOptions.find((option) => option.avatar === avatar) ?? sexOptions[0];

  const selectSex = (sex: Exclude<ProfileDraft['calculationSex'], ''>, nextAvatar: DefaultAvatar) => {
    onChange({ ...draft, calculationSex: sex, theme: defaultThemeForSex(sex) });
    onAvatarChange(nextAvatar);
  };

  return (
    <section className="flux-profile-flow" aria-label="Профиль пользователя">
      <header className="flux-profile-header">
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="Закрыть профиль"><ArrowLeft /></Button>
        <div><span>Профиль</span><strong>Данные для точного расчёта</strong></div>
        <aside className="flux-build-info">
          <button
            aria-expanded={buildInfoOpen}
            aria-label="Показать версию приложения"
            className="flux-build-badge"
            onClick={() => setBuildInfoOpen((open) => !open)}
            type="button"
          >
            v{appVersion.replace(/\.\d+$/, '')}
          </button>
          {buildInfoOpen && (
            <div className="flux-build-popover" role="status">
              <strong>FLUX v{appVersion}</strong>
              <span>{buildRun ? `Установлена сборка #${buildRun}` : 'Локальная сборка'}</span>
              {formatBuildTime(buildAt) && <small>Собрана {formatBuildTime(buildAt)} · Самара</small>}
            </div>
          )}
        </aside>
      </header>

      <form className="flux-profile-content" onSubmit={(event) => { event.preventDefault(); void onDone(); }}>
        <section className="flux-profile-hero">
          <ProfileAvatar avatar={selectedAvatar.avatar} label="Выбранная аватарка" />
          <div>
            <span>Ваш профиль</span>
            <strong>{draft.displayName || account.displayName}</strong>
            <small>@{account.login || 'flux'} · {maskPhone(account.phone)}</small>
          </div>
          <div className="flux-profile-completeness">
            <span>{completeness}% заполнено</span>
            <Progress value={completeness} aria-label={`Профиль заполнен на ${completeness} процентов`} />
          </div>
        </section>

        {draft.calculationSex === '' ? (
          <section className="flux-profile-card">
            <div className="flux-profile-card-heading"><div><span>Пол для расчёта</span><strong>Выберите один раз</strong></div></div>
            <div className="flux-sex-options">
              {sexOptions.map((option) => (
                <button
                  aria-pressed={false}
                  key={option.sex}
                  onClick={() => selectSex(option.sex, option.avatar)}
                  type="button"
                >
                  <ProfileAvatar avatar={option.avatar} />
                  <span><strong>{option.label}</strong><small>Выбрать</small></span>
                </button>
              ))}
            </div>
            <p className="flux-profile-card-note">Пол влияет только на формулы расчёта и аватар по умолчанию. Тему можно менять отдельно.</p>
          </section>
        ) : (
          <section className="flux-profile-card flux-profile-sex-locked">
            <div><span>Пол для расчёта</span><strong>{draft.calculationSex === 'female' ? 'Женский' : 'Мужской'}</strong></div>
            <small>Сохранён в профиле</small>
          </section>
        )}

        <ProfileAccordion eyebrow="Оформление" title="Настроение FLUX">
          <div className="flux-theme-options">
            {fluxThemes.map((theme) => {
              const previewStyle = {
                '--flux-theme-preview-bg': theme.colors[0],
                '--flux-theme-preview-soft': theme.colors[1],
                '--flux-theme-preview-primary': theme.colors[2],
              } as CSSProperties;
              return (
                <button
                  aria-pressed={draft.theme === theme.id}
                  className={draft.theme === theme.id ? 'is-selected' : ''}
                  key={theme.id}
                  onClick={() => set('theme', theme.id)}
                  style={previewStyle}
                  type="button"
                >
                  <span className="flux-theme-preview" aria-hidden="true"><i /><i /><i /></span>
                  <span><strong>{theme.label}</strong><small>{theme.description}</small></span>
                  {draft.theme === theme.id && <Check aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </ProfileAccordion>

        <ProfileAccordion eyebrow="О себе" title="Основа персонального расчёта" defaultOpen>
          <div className="flux-profile-grid">
            <ProfileField label="Имя и фамилия" wide>
              <Input autoComplete="name" value={draft.displayName} onChange={(event) => set('displayName', event.target.value)} />
            </ProfileField>
            <ProfileField label="Дата рождения" wide>
              <span className="flux-profile-date">
                <span className={draft.birthDate ? 'flux-profile-date-value' : 'flux-profile-date-value is-placeholder'}>{formatBirthDate(draft.birthDate)}</span>
                <CalendarDays aria-hidden="true" />
                <Input
                  aria-label="Дата рождения"
                  className="flux-profile-date-native"
                  max={new Date().toISOString().slice(0, 10)}
                  type="date"
                  value={draft.birthDate}
                  onChange={(event) => set('birthDate', event.target.value)}
                />
              </span>
            </ProfileField>
            <ProfileField label="Рост">
              <span className="flux-profile-unit"><Input inputMode="numeric" min="100" max="250" type="number" value={draft.heightCm} onChange={(event) => set('heightCm', event.target.value)} /><i>см</i></span>
            </ProfileField>
            <ProfileField label="Текущий вес">
              <span className="flux-profile-unit"><Input inputMode="decimal" min="30" max="350" step="0.1" type="number" value={draft.currentWeightKg} onChange={(event) => set('currentWeightKg', event.target.value)} /><i>кг</i></span>
            </ProfileField>
          </div>
        </ProfileAccordion>

        <ProfileAccordion eyebrow="Моя цель" title="Спокойный и реалистичный темп">
          <div className="flux-profile-grid">
            <ProfileField label="Цель">
              <span className="flux-profile-select"><select value={draft.goal} onChange={(event) => set('goal', event.target.value as ProfileDraft['goal'])}><option value="">Выберите</option><option value="lose">Похудеть</option><option value="maintain">Поддерживать вес</option><option value="gain">Набрать вес</option></select><ChevronDown aria-hidden="true" /></span>
            </ProfileField>
            {draft.goal !== 'maintain' && <ProfileField label="Желаемый вес"><span className="flux-profile-unit"><Input inputMode="decimal" min="30" max="350" step="0.1" type="number" value={draft.targetWeightKg} onChange={(event) => set('targetWeightKg', event.target.value)} /><i>кг</i></span></ProfileField>}
            {draft.goal !== 'maintain' && <ProfileField label="Темп в неделю"><span className="flux-profile-select"><select value={draft.paceKgPerWeek} onChange={(event) => set('paceKgPerWeek', event.target.value as ProfileDraft['paceKgPerWeek'])}><option value="0.25">0,25 кг · мягко</option><option value="0.5">0,5 кг · комфортно</option><option value="0.75">0,75 кг · интенсивно</option></select><ChevronDown aria-hidden="true" /></span></ProfileField>}
          </div>
        </ProfileAccordion>

        <ProfileAccordion eyebrow="Дневная цель" title="Баланс на каждый день">
          <p className="flux-profile-card-note">Эти значения показываются в дневнике как ориентир. Изменения не затронут уже добавленные продукты.</p>
          <div className="flux-profile-grid">
            <ProfileField label="Калории" wide>
              <span className="flux-profile-unit"><Input inputMode="numeric" min="500" max="10000" type="number" value={draft.dailyCalories} onChange={(event) => set('dailyCalories', event.target.value)} /><i>ккал</i></span>
            </ProfileField>
            <ProfileField label="Белки">
              <span className="flux-profile-unit"><Input inputMode="decimal" min="0" max="1000" step="0.1" type="number" value={draft.dailyProteinG} onChange={(event) => set('dailyProteinG', event.target.value)} /><i>г</i></span>
            </ProfileField>
            <ProfileField label="Жиры">
              <span className="flux-profile-unit"><Input inputMode="decimal" min="0" max="500" step="0.1" type="number" value={draft.dailyFatG} onChange={(event) => set('dailyFatG', event.target.value)} /><i>г</i></span>
            </ProfileField>
            <ProfileField label="Углеводы" wide>
              <span className="flux-profile-unit"><Input inputMode="decimal" min="0" max="1500" step="0.1" type="number" value={draft.dailyCarbsG} onChange={(event) => set('dailyCarbsG', event.target.value)} /><i>г</i></span>
            </ProfileField>
          </div>
        </ProfileAccordion>

        <ProfileAccordion eyebrow="Активность" title="Движение и тренировки">
          <div className="flux-profile-grid">
            <ProfileField label="Обычный день">
              <span className="flux-profile-select"><select value={draft.activity} onChange={(event) => set('activity', event.target.value as ProfileDraft['activity'])}><option value="">Выберите</option><option value="low">В основном сижу</option><option value="medium">Много хожу</option><option value="high">Физически активен</option></select><ChevronDown aria-hidden="true" /></span>
            </ProfileField>
            <ProfileField label="Тренировок в неделю">
              <span className="flux-profile-select"><select value={draft.workoutsPerWeek} onChange={(event) => set('workoutsPerWeek', event.target.value)}><option value="">Выберите</option>{[0, 1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count}</option>)}</select><ChevronDown aria-hidden="true" /></span>
            </ProfileField>
          </div>
        </ProfileAccordion>

        <ProfileAccordion eyebrow="Личное" title="Капсула мотивации" icon={<Pill aria-hidden="true" />}>
          <p className="flux-profile-card-note">Фраза или обещание себе. Она сохранится в вашем профиле и позже сможет появляться на главном экране.</p>
          <label className="flux-profile-capsule-input"><span>Моя капсула</span><textarea value={draft.motivationCapsule} maxLength={180} onChange={(event) => set('motivationCapsule', event.target.value)} placeholder="Например: Я выбираю устойчивый темп, а не идеальный день." /></label>
        </ProfileAccordion>

        <ProfileAccordion eyebrow="Обратная связь" title="Помочь улучшить FLUX" icon={<MessageCircle aria-hidden="true" />} className="flux-profile-feedback">
          <p className="flux-profile-card-note">{feedbackReplyCount ? `Команда ответила на ${feedbackReplyCount} ${feedbackReplyCount === 1 ? 'обращение' : 'обращения'}.` : 'Ошибка, идея или вопрос — сообщение попадёт в рабочую очередь команды.'}</p>
          <Button type="button" variant="secondary" onClick={onFeedback}>{feedbackReplyCount ? `Есть ответ от FLUX · ${feedbackReplyCount}` : 'Написать команде'}</Button>
        </ProfileAccordion>

        <Button className="flux-profile-done" disabled={saving} size="lg" type="submit">{saving ? 'Сохраняю…' : 'Сохранить профиль'}</Button>
        <p className="flux-profile-footnote">Данные сохраняются в вашем профиле FLUX и доступны после входа на другом устройстве.</p>
        <Button className="flux-profile-signout" type="button" variant="ghost" onClick={() => { void onSignOut(); }}><LogOut /> Выйти из аккаунта</Button>
      </form>
    </section>
  );
}
