import { useCallback, useEffect, useState } from 'react';

/**
 * Focus mode — full-screen, a leave warning, and visibility tracking.
 *
 * **This is exam *realism*, not anti-cheat, and the distinction is load-bearing**
 * (brief §2, #5). Everything here is trivially defeated: Escape exits full-screen,
 * a second monitor sidesteps it entirely, and a phone camera defeats any of it.
 * What it buys is that sitting an exam *feels* different from clicking through a
 * quiz — which is the demoable part and the honest claim. If a reviewer pokes at
 * it, the correct answer is "it isn't trying to stop you", not a patched hole.
 *
 * `visibilityChanges` is counted for the same reason: it is a *signal to show the
 * candidate afterwards*, not evidence. Phase C may record it on the attempt;
 * neither should ever be phrased as a cheating accusation.
 */

export type FocusModeState = {
  isFullscreen: boolean;
  /** Times the tab was hidden while the attempt ran. Informational only. */
  visibilityChanges: number;
  /** True when focus mode was asked for but full-screen was refused or exited. */
  degraded: boolean;
};

export function useFocusMode(enabled: boolean, active: boolean) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [visibilityChanges, setVisibilityChanges] = useState(0);

  const enter = useCallback(async () => {
    if (!enabled) return;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Refused — an iframe without `allow="fullscreen"`, a browser policy, or a
      // user gesture the browser did not accept. The attempt continues without
      // it: losing the chrome is not a reason to block someone from sitting an
      // exam. `degraded` tells the UI to stop promising a full-screen experience.
    }
  }, [enabled]);

  const exit = useCallback(async () => {
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // Nothing useful to do; the element is already leaving or gone.
    }
  }, []);

  // Track full-screen from the *event*, never from our own call. The user can
  // leave with Escape without telling us, and a flag we set optimistically would
  // then claim a full-screen that ended seconds ago.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setVisibilityChanges(count => count + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active]);

  /**
   * The browser's own "leave site?" prompt while an attempt is in progress.
   *
   * Deliberately the native dialog rather than a custom one: browsers ignore
   * custom text here, and this is the one guard that survives a closed tab —
   * which is the way an attempt is most likely to be lost by accident.
   */
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require a truthy returnValue to show the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  // Never leave the document full-screen once the attempt is over. Forgetting
  // this strands the whole app in full-screen after submission.
  useEffect(() => {
    if (!active && document.fullscreenElement) void exit();
  }, [active, exit]);

  const state: FocusModeState = {
    isFullscreen,
    visibilityChanges,
    degraded: enabled && active && !isFullscreen,
  };

  return { ...state, enter, exit };
}
