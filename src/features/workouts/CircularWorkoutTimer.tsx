import { normalizeTimerProgress } from './circularTimer';

const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type CircularWorkoutTimerProps = {
  mode: 'work' | 'rest';
  formattedTime: string;
  progress: number;
  paused?: boolean;
  eyebrow?: string;
  stateLabel: string;
  planLabel?: string;
  reachedPlan?: boolean;
};

/**
 * Presentational only: callers own their clocks, deadlines and persistence.
 */
export function CircularWorkoutTimer({
  mode,
  formattedTime,
  progress,
  paused = false,
  eyebrow,
  stateLabel,
  planLabel,
  reachedPlan = false,
}: CircularWorkoutTimerProps) {
  const normalizedProgress = normalizeTimerProgress(progress);
  const offset = RING_CIRCUMFERENCE * (1 - normalizedProgress);
  return <div
    className={`flux-circular-timer is-${mode}${paused ? ' is-paused' : ''}${reachedPlan ? ' has-reached-plan' : ''}`}
    role="timer"
    aria-label={`${stateLabel}: ${formattedTime}`}
    data-mode={mode}
    data-progress={normalizedProgress.toFixed(3)}
  >
    <svg viewBox="0 0 112 112" aria-hidden="true" focusable="false">
      <circle className="flux-circular-timer-track" cx="56" cy="56" r={RING_RADIUS} />
      <circle
        className="flux-circular-timer-progress"
        cx="56"
        cy="56"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
      />
    </svg>
    <div className="flux-circular-timer-content">
      {eyebrow && <span className="flux-circular-timer-eyebrow">{eyebrow}</span>}
      <strong className="flux-circular-timer-value">{formattedTime}</strong>
      <span className="flux-circular-timer-state">{stateLabel}</span>
      {planLabel && <small>{planLabel}{reachedPlan ? ' · цель достигнута' : ''}</small>}
    </div>
  </div>;
}
