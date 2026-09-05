import { useEffect, useRef, useState } from 'react';

/**
 * Remaining milliseconds against an absolute deadline.
 *
 * **Counts down to a timestamp rather than decrementing a number**, which is the
 * only version that survives a backgrounded tab: browsers throttle timers in
 * hidden tabs to once a minute or stop them entirely, so a decrementing counter
 * comes back minutes fast and hands the candidate free time. Recomputing from
 * `Date.now()` means a tab that was asleep for ten minutes returns showing ten
 * minutes gone, which is what a real exam does.
 *
 * `onExpire` fires exactly once, through a ref, so that passing an inline arrow
 * from the calling component does not re-arm the effect on every render and
 * auto-submit the attempt twice.
 */
export function useExamTimer(expiresAt: number | null, onExpire: () => void) {
  const [remainingMs, setRemainingMs] = useState(() =>
    expiresAt === null ? null : Math.max(0, expiresAt - Date.now()),
  );

  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const firedRef = useRef(false);

  useEffect(() => {
    if (expiresAt === null) {
      setRemainingMs(null);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };

    tick();
    // 250ms rather than 1000ms: at a one-second interval the displayed seconds
    // visibly stutter, because the tick and the wall clock drift out of phase.
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return remainingMs;
}
