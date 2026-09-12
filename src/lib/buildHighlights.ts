const buildHighlights: Record<string, readonly string[]> = {
  '102': ['Прямой переход в чат тренера', 'Исправлена навигация Messenger'],
  '103': ['Номер сборки стал заметнее', 'Проще проверить актуальную версию'],
  '104': ['Понятнее, что изменилось', 'Карточка сборки без технических деталей'],
};

const fallbackHighlights = ['Техническое обновление'] as const;

export function getBuildHighlights(buildNumber?: string) {
  return buildNumber ? buildHighlights[buildNumber] ?? fallbackHighlights : fallbackHighlights;
}
