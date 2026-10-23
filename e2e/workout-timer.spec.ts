import { expect, test } from '@playwright/test';
import { restTimerProgress, workTimerProgress } from '../src/features/workouts/circularTimer';
import { elapsedDurationSeconds, elapsedDurationSecondsPrecise, pauseDurationClock, remainingRestSeconds, remainingRestSecondsPrecise, restProgressDegrees, startDurationClock } from '../src/features/workouts/timer';
import { minutesSecondsToSeconds, secondsToMinutesSeconds } from '../src/features/workouts/timeInput';

test('Workout timer math: duration counts forward, excludes pauses, and resumes', () => {
  const started = startDurationClock({ accumulatedSeconds: 0, startedAtMs: null }, 1_000);
  expect(elapsedDurationSeconds(started, 4_900)).toBe(3);

  const paused = pauseDurationClock(started, 4_900);
  expect(paused).toEqual({ accumulatedSeconds: 3.9, startedAtMs: null });
  expect(elapsedDurationSeconds(paused, 20_000)).toBe(3);

  const resumed = startDurationClock(paused, 20_000);
  expect(elapsedDurationSeconds(resumed, 23_600)).toBe(7);
});

test('Workout timer math: planned duration never caps actual elapsed time', () => {
  const running = startDurationClock({ accumulatedSeconds: 0, startedAtMs: null }, 0);
  const plannedSeconds = 30;
  expect(elapsedDurationSeconds(running, 45_000)).toBeGreaterThan(plannedSeconds);
});

test('Circular timer progress: work fills at the planned duration and rest drains to zero', () => {
  expect(workTimerProgress(0, 30)).toBe(0);
  expect(workTimerProgress(4, 30)).toBeCloseTo(4 / 30);
  expect(workTimerProgress(12, 30)).toBeCloseTo(12 / 30);
  expect(workTimerProgress(15, 30)).toBe(0.5);
  expect(workTimerProgress(45, 30)).toBe(1);
  expect(workTimerProgress(12, null)).toBe(0);

  expect(restTimerProgress(30, 60)).toBe(0.5);
  expect(restTimerProgress(0, 60)).toBe(0);
  expect(restTimerProgress(30, 0)).toBe(0);
});

test('Circular timer visual math stays time-derived between digital seconds', () => {
  const clock = startDurationClock({ accumulatedSeconds: 0, startedAtMs: null }, 1_000);
  expect(elapsedDurationSeconds(clock, 1_500)).toBe(0);
  expect(elapsedDurationSecondsPrecise(clock, 1_500)).toBe(0.5);
  expect(workTimerProgress(elapsedDurationSecondsPrecise(clock, 1_500), 30)).toBeCloseTo(1 / 60);
  expect(remainingRestSeconds(10_000, 9_500)).toBe(1);
  expect(remainingRestSecondsPrecise(10_000, 9_500)).toBe(0.5);
  expect(restTimerProgress(remainingRestSecondsPrecise(10_000, 9_500), 10)).toBeCloseTo(0.05);
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

test('Minutes/seconds input: preserves nullable seconds and supports long durations', () => {
  expect(secondsToMinutesSeconds(null)).toEqual({ minutes: '', seconds: '' });
  expect(secondsToMinutesSeconds(30)).toEqual({ minutes: '0', seconds: '30' });
  expect(secondsToMinutesSeconds(60)).toEqual({ minutes: '1', seconds: '00' });
  expect(secondsToMinutesSeconds(3600)).toEqual({ minutes: '60', seconds: '00' });
  expect(secondsToMinutesSeconds(90)).toEqual({ minutes: '1', seconds: '30' });

  expect(minutesSecondsToSeconds('', '')).toEqual({ value: null, error: null });
  expect(minutesSecondsToSeconds('1', '30')).toEqual({ value: 90, error: null });
  expect(minutesSecondsToSeconds('60', '00')).toEqual({ value: 3600, error: null });
  expect(minutesSecondsToSeconds('1', '60')).toEqual({ value: null, error: 'Секунды должны быть от 0 до 59.' });
});
