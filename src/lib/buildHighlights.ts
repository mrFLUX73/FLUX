export type BuildChange = {
  title: string;
  description: string;
};

export type BuildRelease = {
  number: string;
  title: string;
  highlights: readonly string[];
  details: readonly BuildChange[];
};

const releases: Record<string, BuildRelease> = {
  '104': {
    number: '104', title: 'Понятнее, что изменилось',
    highlights: ['Карточка сборки без технических деталей'],
    details: [{ title: 'Информация о сборке', description: 'В профиле стало проще понять, что изменилось после обновления FLUX.' }],
  },
  '105': {
    number: '105', title: 'Messenger стал компактнее и удобнее',
    highlights: ['Диалоги легче читать', 'Сообщения занимают меньше места'],
    details: [{ title: 'Messenger', description: 'Список диалогов и переписка стали компактнее, сохранив привычную навигацию.' }],
  },
  '106': {
    number: '106', title: 'Выбор прошлых приёмов пищи',
    highlights: ['Можно выбрать не только последний приём', 'Доступны прошлые завтраки, обеды и ужины'],
    details: [{ title: 'Повторение приёмов', description: 'Перед повторением можно выбрать один из предыдущих непустых приёмов пищи.' }],
  },
  '107': {
    number: '107', title: 'Удобнее повторять приёмы пищи',
    highlights: ['Можно выбрать прошлый приём', 'Можно изменить граммы, мл или количество штук', 'КБЖУ пересчитается автоматически'],
    details: [
      { title: 'Количество продуктов', description: 'Перед повторением приёма можно изменить количество каждого продукта: например, 180 г риса → 250 г или 1 яйцо → 2 шт.' },
      { title: 'Автоматический пересчёт', description: 'После изменения количества FLUX автоматически пересчитывает калории, белки, жиры и углеводы.' },
      { title: 'Выбор прошлого приёма', description: 'Можно выбрать один из предыдущих непустых завтраков, обедов, ужинов или перекусов, а не только последний.' },
      { title: 'История остаётся неизменной', description: 'Изменение количества применяется только к новому приёму. Исходная запись в истории питания не изменяется.' },
      { title: 'Удобство на iPhone', description: 'Редактор количества адаптирован для мобильного использования и работы с экранной клавиатурой.' },
    ],
  },
  '108': {
    number: '108', title: 'Что нового в FLUX',
    highlights: ['Сразу видно, что появилось', 'Доступен полный список изменений', 'Можно посмотреть предыдущие обновления'],
    details: [
      { title: 'Коротко о главном', description: 'В профиле обновления теперь описаны короткими понятными тезисами.' },
      { title: 'Подробности по желанию', description: 'Полный список изменений открывается в отдельном слое, не уводя из профиля.' },
      { title: 'История обновлений', description: 'Можно посмотреть известные предыдущие сборки и вернуться к текущей информации.' },
    ],
  },
};

const fallbackRelease: BuildRelease = {
  number: '', title: 'Техническое обновление', highlights: ['FLUX стал стабильнее'],
  details: [{ title: 'Обновление FLUX', description: 'Мы продолжаем улучшать приложение.' }],
};

export function getBuildRelease(buildNumber?: string) {
  return buildNumber ? releases[buildNumber] ?? { ...fallbackRelease, number: buildNumber } : fallbackRelease;
}

export function getKnownBuildReleases() {
  return Object.values(releases).sort((left, right) => Number(right.number) - Number(left.number));
}
