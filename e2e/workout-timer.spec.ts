import { expect, test } from '@playwright/test';
import { elapsedDurationSeconds, pauseDurationClock, remainingRestSeconds, restProgressDegrees, startDurationClock } from '../src/features/workouts/timer';

test('Workout timer math: duration counts forward, excludes pauses, and resumes', () => {
  const started = startDurationClock({ accumulatedSeconds: 0, startedAtMs: null }, 1_000);
  expect(elapsedDurationSeconds(started, 4_900)).toBe(3);

  const paused = pauseDurationClock(started, 4_900);
  expect(paused).toEqual({ accumulatedSeconds: 3, startedAtMs: null });
  expect(elapsedDurationSeconds(paused, 20_000)).toBe(3);

  const resumed = startDurationClock(paused, 20_000);
  expect(elapsedDurationSeconds(resumed, 23_600)).toBe(6);
});

test('Workout timer math: planned duration never caps actual elapsed time', () => {
  const running = startDurationClock({ accumulatedSeconds: 0, startedAtMs: null }, 0);
  const plannedSeconds = 30;
  expect(elapsedDurationSeconds(running, 45_000)).toBeGreaterThan(plannedSeconds);
});

test('Workout timer math: rest progress reflects the live deadline and handles zero rest', () => {
  const endsAt = 10_000;
  const remaining = remainingRestSeconds(endsAt, 5_000);
  expect(remaining).toBe(5);
  expect(restProgressDegrees(remaining, 10)).toBe(180);
  expect(restProgressDegrees(remainingRestSeconds(endsAt, 10_001), 10)).toBe(0);
  expect(restProgressDegrees(0, 0)).toBe(0);
});

test('Workout timer math: a restored running clock includes closed-app time while a paused clock does not', () => {
  const restoredRunning = { accumulatedSeconds: 12, startedAtMs: 10_000 };
  expect(elapsedDurationSeconds(restoredRunning, 18_900)).toBe(20);

  const restoredPaused = { accumulatedSeconds: 12, startedAtMs: null };
  expect(elapsedDurationSeconds(restoredPaused, 18_900)).toBe(12);
  expect(remainingRestSeconds(30_000, 31_000)).toBe(0);
});
