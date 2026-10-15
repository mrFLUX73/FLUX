export type DurationClock = {
  accumulatedSeconds: number;
  startedAtMs: number | null;
};

const nonNegative = (value: number) => Math.max(0, value);

export function elapsedDurationSeconds(clock: DurationClock, nowMs: number): number {
  if (clock.startedAtMs == null) return nonNegative(clock.accumulatedSeconds);
  return nonNegative(clock.accumulatedSeconds + Math.floor((nowMs - clock.startedAtMs) / 1000));
}

export function startDurationClock(clock: DurationClock, nowMs: number): DurationClock {
  return clock.startedAtMs == null ? { ...clock, startedAtMs: nowMs } : clock;
}

export function pauseDurationClock(clock: DurationClock, nowMs: number): DurationClock {
  return { accumulatedSeconds: elapsedDurationSeconds(clock, nowMs), startedAtMs: null };
}

export function remainingRestSeconds(restEndsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((restEndsAtMs - nowMs) / 1000));
}

export function restProgressDegrees(remainingSeconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.min(360, Math.max(0, (remainingSeconds / totalSeconds) * 360));
}
