/**
 * Converts elapsed work time to a visual fraction without ever capping the
 * underlying actual duration. The duration clock remains the source of truth.
 */
export function normalizeTimerProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function workTimerProgress(elapsedSeconds: number, plannedSeconds: number | null | undefined) {
  if (!plannedSeconds || plannedSeconds <= 0) return 0;
  return normalizeTimerProgress(elapsedSeconds / plannedSeconds);
}

/**
 * Converts the deadline-derived rest remaining time to a visual fraction.
 */
export function restTimerProgress(remainingSeconds: number, totalSeconds: number | null | undefined) {
  if (!totalSeconds || totalSeconds <= 0) return 0;
  return normalizeTimerProgress(remainingSeconds / totalSeconds);
}
