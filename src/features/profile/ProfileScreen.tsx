import { ArrowLeft, Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { FluxAccount } from '../auth/phonePasswordAuth';

export type DefaultAvatar = 'short-hair' | 'bun';

export type ProfileDraft = {
  displayName: string;
  birthDate: string;
  calculationSex: '' | 'female' | 'male';
  heightCm: string;
  currentWeightKg: string;
  goal: '' | 'lose' | 'maintain' | 'gain';
  targetWeightKg: string;
  paceKgPerWeek: '' | '0.25' | '0.5' | '0.75';
  activity: '' | 'low' | 'medium' | 'high';
  workoutsPerWeek: string;
};

export function createProfileDraft(account: FluxAccount): ProfileDraft {
  return {
    displayName: account.displayName,
    birthDate: '',
    calculationSex: '',
    heightCm: '',
    currentWeightKg: '',
    goal: 'lose',
    targetWeightKg: '',
    paceKgPerWeek: '0.5',
    activity: '',
    workoutsPerWeek: '',
  };
}

const sexOptions: { sex: Exclude<ProfileDraft['calculationSex'], ''>; avatar: DefaultAvatar; label: string; src: string }[] = [
  { sex: 'male', avatar: 'short-hair', label: 'Мужской', src: `${import.meta.env.BASE_URL}avatars/avatar-short-hair.png` },
  { sex: 'female', avatar: 'bun', label: 'Женский', src: `${import.meta.env.BASE_URL}avatars/avatar-bun.png` },
];

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 11) return 'Номер сохранён приватно';
  return `+7 ••• •••-${digits.slice(-4, -2)}-${digits.slice(-2)}`;
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

export function ProfileScreen({
  account,
  avatar,
  draft,
  onAvatarChange,
  onChange,
  onClose,
  onDone,
  saving,
}: {
  account: FluxAccount;
  avatar: DefaultAvatar;
  draft: ProfileDraft;
  onAvatarChange: (avatar: DefaultAvatar) => void;
  onChange: (draft: ProfileDraft) => void;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  saving: boolean;
}) {
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
    onChange({ ...draft, calculationSex: sex });
    onAvatarChange(nextAvatar);
  };

  return (
    <section className="flux-profile-flow" aria-label="Профиль пользователя">
      <header className="flux-profile-header">
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="Закрыть профиль"><ArrowLeft /></Button>
        <div><span>Профиль</span><strong>Данные для точного расчёта</strong></div>
        <span aria-hidden="true" />
      </header>

      <form className="flux-profile-content" onSubmit={(event) => { event.preventDefault(); void onDone(); }}>
        <section className="flux-profile-hero">
          <img src={selectedAvatar.src} alt="Выбранная аватарка" />
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

        <section className="flux-profile-card">
          <div className="flux-profile-card-heading"><div><span>Пол</span><strong>Выберите подходящий вариант</strong></div></div>
          <div className="flux-sex-options">
            {sexOptions.map((option) => (
              <button
                aria-pressed={draft.calculationSex === option.sex}
                className={draft.calculationSex === option.sex ? 'is-selected' : ''}
                key={option.sex}
                onClick={() => selectSex(option.sex, option.avatar)}
                type="button"
              >
                <img src={option.src} alt="" />
                <span><strong>{option.label}</strong><small>{draft.calculationSex === option.sex ? 'Выбрано' : 'Выбрать'}</small></span>
                {draft.calculationSex === option.sex && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
        </section>

        <section className="flux-profile-card">
          <div className="flux-profile-card-heading"><div><span>О себе</span><strong>Основа персонального расчёта</strong></div></div>
          <div className="flux-profile-grid">
            <ProfileField label="Имя и фамилия" wide>
              <Input autoComplete="name" value={draft.displayName} onChange={(event) => set('displayName', event.target.value)} />
            </ProfileField>
            <ProfileField label="Дата рождения" wide>
              <span className="flux-profile-date">
                <Input type="date" value={draft.birthDate} onChange={(event) => set('birthDate', event.target.value)} />
              </span>
            </ProfileField>
            <ProfileField label="Рост">
              <span className="flux-profile-unit"><Input inputMode="numeric" min="100" max="250" type="number" value={draft.heightCm} onChange={(event) => set('heightCm', event.target.value)} /><i>см</i></span>
            </ProfileField>
            <ProfileField label="Текущий вес">
              <span className="flux-profile-unit"><Input inputMode="decimal" min="30" max="350" step="0.1" type="number" value={draft.currentWeightKg} onChange={(event) => set('currentWeightKg', event.target.value)} /><i>кг</i></span>
            </ProfileField>
          </div>
        </section>

        <section className="flux-profile-card">
          <div className="flux-profile-card-heading"><div><span>Моя цель</span><strong>Спокойный и реалистичный темп</strong></div></div>
          <div className="flux-profile-grid">
            <ProfileField label="Цель">
              <span className="flux-profile-select"><select value={draft.goal} onChange={(event) => set('goal', event.target.value as ProfileDraft['goal'])}><option value="">Выберите</option><option value="lose">Похудеть</option><option value="maintain">Поддерживать вес</option><option value="gain">Набрать вес</option></select><ChevronDown aria-hidden="true" /></span>
            </ProfileField>
            {draft.goal !== 'maintain' && <ProfileField label="Желаемый вес"><span className="flux-profile-unit"><Input inputMode="decimal" min="30" max="350" step="0.1" type="number" value={draft.targetWeightKg} onChange={(event) => set('targetWeightKg', event.target.value)} /><i>кг</i></span></ProfileField>}
            {draft.goal !== 'maintain' && <ProfileField label="Темп в неделю"><span className="flux-profile-select"><select value={draft.paceKgPerWeek} onChange={(event) => set('paceKgPerWeek', event.target.value as ProfileDraft['paceKgPerWeek'])}><option value="0.25">0,25 кг · мягко</option><option value="0.5">0,5 кг · комфортно</option><option value="0.75">0,75 кг · интенсивно</option></select><ChevronDown aria-hidden="true" /></span></ProfileField>}
          </div>
        </section>

        <section className="flux-profile-card">
          <div className="flux-profile-card-heading"><div><span>Активность</span><strong>Движение вне и внутри тренировок</strong></div></div>
          <div className="flux-profile-grid">
            <ProfileField label="Обычный день">
              <span className="flux-profile-select"><select value={draft.activity} onChange={(event) => set('activity', event.target.value as ProfileDraft['activity'])}><option value="">Выберите</option><option value="low">В основном сижу</option><option value="medium">Много хожу</option><option value="high">Физически активен</option></select><ChevronDown aria-hidden="true" /></span>
            </ProfileField>
            <ProfileField label="Тренировок в неделю">
              <span className="flux-profile-select"><select value={draft.workoutsPerWeek} onChange={(event) => set('workoutsPerWeek', event.target.value)}><option value="">Выберите</option>{[0, 1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count}</option>)}</select><ChevronDown aria-hidden="true" /></span>
            </ProfileField>
          </div>
        </section>

        <Button className="flux-profile-done" disabled={saving} size="lg" type="submit">{saving ? 'Сохраняю…' : 'Сохранить профиль'}</Button>
        <p className="flux-profile-footnote">Данные сохраняются в вашем профиле FLUX и доступны после входа на другом устройстве.</p>
      </form>
    </section>
  );
}
