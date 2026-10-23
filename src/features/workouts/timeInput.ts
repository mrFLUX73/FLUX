export type MinutesSeconds = { minutes: string; seconds: string };
export type MinutesSecondsResult = { value: number | null; error: string | null };

export function secondsToMinutesSeconds(value: number | null | undefined): MinutesSeconds {
  if (value == null || !Number.isFinite(value) || value < 0) return { minutes: '', seconds: '' };
  const wholeSeconds = Math.floor(value);
  return {
    minutes: String(Math.floor(wholeSeconds / 60)),
    seconds: String(wholeSeconds % 60).padStart(2, '0'),
  };
}

export function minutesSecondsToSeconds(minutesText: string, secondsText: string): MinutesSecondsResult {
  const minutes = minutesText.trim();
  const seconds = secondsText.trim();
  if (!minutes && !seconds) return { value: null, error: null };
  if (minutes && !/^\d+$/.test(minutes)) return { value: null, error: 'Минуты должны быть неотрицательным целым числом.' };
  if (seconds && !/^\d+$/.test(seconds)) return { value: null, error: 'Секунды должны быть целым числом.' };
  const minuteValue = minutes ? Number(minutes) : 0;
  const secondValue = seconds ? Number(seconds) : 0;
  if (!Number.isSafeInteger(minuteValue) || minuteValue < 0) return { value: null, error: 'Минуты должны быть неотрицательным целым числом.' };
  if (!Number.isSafeInteger(secondValue) || secondValue < 0 || secondValue > 59) return { value: null, error: 'Секунды должны быть от 0 до 59.' };
  return { value: minuteValue * 60 + secondValue, error: null };
}
