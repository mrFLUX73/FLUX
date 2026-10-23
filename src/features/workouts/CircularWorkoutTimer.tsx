import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
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
  visualProgress?: (nowMs: number) => number;
  completed?: boolean;
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
  visualProgress,
  completed = false,
}: CircularWorkoutTimerProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(() => normalizeTimerProgress(progress));
  const wasAnimating = useRef(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!visualProgress || paused || reducedMotion) {
      // Preserve the exact rAF frame when a running timer is paused. The
      // persisted/digital clock intentionally stores whole seconds, so
      // replacing that frame with `progress` would make the arc jump back.
      if (!paused || reducedMotion || !wasAnimating.current) setDisplayProgress(normalizeTimerProgress(progress));
      wasAnimating.current = false;
      return;
    }
    const getVisualProgress = visualProgress;
    wasAnimating.current = true;
    let frame = 0;
    const animate = () => { setDisplayProgress(normalizeTimerProgress(getVisualProgress(Date.now()))); frame = window.requestAnimationFrame(animate); };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [paused, progress, reducedMotion, visualProgress]);
  const normalizedProgress = displayProgress;
  const offset = RING_CIRCUMFERENCE * (1 - normalizedProgress);
  return <div
    className={`flux-circular-timer is-${mode}${paused ? ' is-paused' : ''}${reachedPlan ? ' has-reached-plan' : ''}${completed ? ' is-completed' : ''}`}
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
      {completed && <span className="flux-circular-timer-complete" aria-label="Подход завершён"><Check /></span>}
    </div>
  </div>;
}
