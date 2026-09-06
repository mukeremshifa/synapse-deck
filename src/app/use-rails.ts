import { useCallback, useState } from 'react';

/**
 * Which of the notebook shell's two rails are open, remembered across sessions.
 *
 * Its own file rather than living in `NotebookLayout.tsx`: a module that exports
 * both a component and a hook defeats React Fast Refresh, which then does a full
 * reload on every edit to the layout — the file being edited most during a
 * rewrite is the worst one to make slow.
 *
 * `localStorage` is wrapped in try/catch because it *throws* rather than
 * returning null in some privacy modes, and a shell that cannot mount is a far
 * worse failure than a rail that forgot it was closed.
 */

export type RailKey = 'sources' | 'studio';

const STORAGE_KEY = 'synapsedeck:rails';
const DEFAULTS: Record<RailKey, boolean> = { sources: true, studio: true };

function readRailState(): Record<RailKey, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<RailKey, boolean>>;
    return {
      sources: parsed.sources ?? DEFAULTS.sources,
      studio: parsed.studio ?? DEFAULTS.studio,
    };
  } catch {
    return DEFAULTS;
  }
}

function persistRailState(state: Record<RailKey, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A rail that forgets its state is a small loss. Failing to render is not.
  }
}

export function useRails() {
  const [open, setOpen] = useState<Record<RailKey, boolean>>(readRailState);

  const toggle = useCallback((key: RailKey) => {
    setOpen(current => {
      const next = { ...current, [key]: !current[key] };
      persistRailState(next);
      return next;
    });
  }, []);

  return { open, toggle };
}
