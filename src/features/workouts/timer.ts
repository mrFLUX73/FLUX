export type DurationClock = {
  accumulatedSeconds: number;
  startedAtMs: number | null;
};

const nonNegative = (value: number) => Math.max(0, value);

export function elapsedDurationSeconds(clock: DurationClock, nowMs: number): number {
  return Math.floor(elapsedDurationSecondsPrecise(clock, nowMs));
}

/** Visual-only precision for animation; persisted and digital values stay whole seconds. */
export function elapsedDurationSecondsPrecise(clock: DurationClock, nowMs: number): number {
  if (clock.startedAtMs == null) return nonNegative(clock.accumulatedSeconds);
  return nonNegative(clock.accumulatedSeconds + (nowMs - clock.startedAtMs) / 1000);
}

export function startDurationClock(clock: DurationClock, nowMs: number): DurationClock {
  return clock.startedAtMs == null ? { ...clock, startedAtMs: nowMs } : clock;
}

export function pauseDurationClock(clock: DurationClock, nowMs: number): DurationClock {
  // Keep the timestamp-derived fractional remainder in memory. It is needed
  // only to resume the visual ring from its exact paused position; callers
  // still persist and display whole seconds through elapsedDurationSeconds.
  return { accumulatedSeconds: elapsedDurationSecondsPrecise(clock, nowMs), startedAtMs: null };
}

export function remainingRestSeconds(restEndsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((restEndsAtMs - nowMs) / 1000));
}

/** Visual-only precision derived from the existing rest deadline. */
export function remainingRestSecondsPrecise(restEndsAtMs: number, nowMs: number): number {
  return Math.max(0, (restEndsAtMs - nowMs) / 1000);
}

export function restProgressDegrees(remainingSeconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.min(360, Math.max(0, (remainingSeconds / totalSeconds) * 360));
}
