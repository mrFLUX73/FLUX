import { useEffect, useId, useRef, useState } from 'react';
import { minutesSecondsToSeconds, secondsToMinutesSeconds } from './timeInput';

type Props = {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  minutesAriaLabel?: string;
  secondsAriaLabel?: string;
  optional?: boolean;
  disabled?: boolean;
};

/** UI-only adapter: values remain nullable seconds outside this component. */
export function MinutesSecondsInput({ label, value, onChange, minutesAriaLabel, secondsAriaLabel, optional = false, disabled = false }: Props) {
  const initial = secondsToMinutesSeconds(value);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [seconds, setSeconds] = useState(initial.seconds);
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef<number | null | undefined>(undefined);
  const errorId = useId();

  useEffect(() => {
    if (lastEmitted.current === value) return;
    const next = secondsToMinutesSeconds(value);
    setMinutes(next.minutes);
    setSeconds(next.seconds);
    setError(null);
  }, [value]);

  const update = (nextMinutes: string, nextSeconds: string) => {
    setMinutes(nextMinutes);
    setSeconds(nextSeconds);
    const parsed = minutesSecondsToSeconds(nextMinutes, nextSeconds);
    setError(parsed.error);
    if (!parsed.error) { lastEmitted.current = parsed.value; onChange(parsed.value); }
  };

  return <fieldset className="flux-minutes-seconds" aria-describedby={error ? errorId : undefined}>
    <legend>{label}{optional && <small>необязательно</small>}</legend>
    <div>
      <label><span className="sr-only">{minutesAriaLabel ?? `${label}: минуты`}</span><input aria-label={minutesAriaLabel ?? `${label}: минуты`} autoComplete="off" inputMode="numeric" pattern="[0-9]*" value={minutes} disabled={disabled} onChange={(event) => update(event.target.value, seconds)} /><b aria-hidden="true">мин</b></label>
      <label><span className="sr-only">{secondsAriaLabel ?? `${label}: секунды`}</span><input aria-label={secondsAriaLabel ?? `${label}: секунды`} autoComplete="off" inputMode="numeric" pattern="[0-9]*" value={seconds} disabled={disabled} onChange={(event) => update(minutes, event.target.value)} /><b aria-hidden="true">сек</b></label>
    </div>
    {error && <small id={errorId} className="flux-time-input-error" role="alert">{error}</small>}
  </fieldset>;
}
