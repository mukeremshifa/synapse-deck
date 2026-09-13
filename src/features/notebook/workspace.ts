import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * What the workspace pane is showing, and where that lives.
 *
 * ═══ The decision: the selection is in the URL ═══════════════════════════
 *
 * The workspace is the notebook's centre column, and it shows exactly one of
 * three things: a source, a deck's cards, or the overview. **Which one is a
 * search parameter** — `?view=source&item=<id>` — not `useState`.
 *
 * That follows `modals.tsx`'s own test rather than inventing a second rule.
 * Its line is that a route is *a place you can be, link to, and return to*, and
 * that is why a generate modal is in the URL and a delete confirmation is not.
 * A workspace selection passes that test on every clause: you can be reading a
 * source, you can send someone the notebook with that source open, and coming
 * back to it is the ordinary thing to want. Reading a source is no longer the
 * glance-and-dismiss that justified `SourcesPane` holding it locally — in the
 * workspace it is where you *stay* while you generate cards beside it.
 *
 * It also settles the trap the brief flagged, which is a real bug's scar
 * tissue: **every runner route names its artifact**, because a route that read
 * `:notebookId` and treated it as a deck id once served one notebook's session
 * every notebook's cards. Making the workspace able to open a deck *without*
 * navigating would have reintroduced exactly that — a deck on screen that the
 * address cannot name. `?view=deck&item=<deckId>` keeps the URL honest.
 *
 * ── Two params, not one per kind ─────────────────────────────────────────
 *
 * `view` says what kind of thing, `item` says which one. The alternative —
 * `?sourceId=` / `?deckId=` — makes "both set" a state the type system cannot
 * forbid, so every reader would need a precedence rule and they would disagree.
 * One discriminant and one id makes the invalid state unrepresentable.
 *
 * ── Nothing here is trusted ──────────────────────────────────────────────
 *
 * These are user-editable text, exactly as `modals.tsx` says of its own params.
 * An unknown `view` reads as the overview rather than throwing, and a `view`
 * that needs an id and has none does the same. A hand-typed `?view=nonsense`
 * shows the notebook, and an `item` naming something that does not exist is
 * resolved — and reported — by whatever renders it, which is the only layer
 * that can tell a deleted source from a fabricated id.
 */

/** What the workspace can show. The overview is the resting state. */
export type WorkspaceView =
  /** The notebook's own summary — readiness, diagnostics, what to do next. */
  | { kind: 'overview' }
  /** One source, read in place. */
  | { kind: 'source'; id: string }
  /** One deck's cards, browsed and edited in place. */
  | { kind: 'deck'; id: string };

/** The param carrying which kind of thing is open. */
const VIEW_PARAM = 'view';
/** The param carrying which one. Meaningless without a `view` that takes an id. */
const ITEM_PARAM = 'item';

/** The views that name a thing, and so are nothing without an `item`. */
const NEEDS_ITEM = ['source', 'deck'] as const;

type ItemView = (typeof NEEDS_ITEM)[number];

function needsItem(value: string): value is ItemView {
  return (NEEDS_ITEM as readonly string[]).includes(value);
}

export interface WorkspaceController {
  /** What is open. Never null — the overview is what "nothing selected" means. */
  readonly view: WorkspaceView;
  /** Open something in the workspace. Pushes, so back returns to what was open. */
  readonly show: (next: WorkspaceView) => void;
}

/**
 * Reads and writes what the workspace is showing.
 *
 * ── Push, not replace, and the asymmetry with `modals.tsx` ───────────────
 *
 * Opening a modal pushes so back can close it; closing replaces so back cannot
 * reopen it. The workspace has no "closed" — there is always a view — so every
 * change is a push and back simply walks the selections in order. That is what
 * a user means by back here: return to what I was looking at, not leave.
 */
export function useWorkspace(): WorkspaceController {
  const [params, setParams] = useSearchParams();

  const rawView = params.get(VIEW_PARAM);
  const rawItem = params.get(ITEM_PARAM);

  const view = useMemo<WorkspaceView>(() => {
    if (rawView === null) return { kind: 'overview' };
    /*
     * A view that names a thing, with nothing named, is not an error state to
     * render — it is a URL that means the overview, which is what it falls back
     * to. The empty-string check matters: `?view=source&item=` parses to `''`,
     * not null, and an empty id would reach a query as a real lookup.
     */
    if (needsItem(rawView)) {
      if (rawItem === null || rawItem === '') return { kind: 'overview' };
      return { kind: rawView, id: rawItem };
    }
    return { kind: 'overview' };
  }, [rawView, rawItem]);

  const show = useCallback(
    (next: WorkspaceView) => {
      const updated = new URLSearchParams(params);
      if (next.kind === 'overview') {
        // The resting state is the *absence* of the params, so a notebook
        // showing its overview has the clean URL a user would expect to share.
        updated.delete(VIEW_PARAM);
        updated.delete(ITEM_PARAM);
      } else {
        updated.set(VIEW_PARAM, next.kind);
        updated.set(ITEM_PARAM, next.id);
      }
      setParams(updated);
    },
    [params, setParams],
  );

  return useMemo(() => ({ view, show }), [view, show]);
}

/**
 * The workspace selection as a link target, for the places that should be
 * links rather than buttons.
 *
 * A source row and a "Browse cards" action navigate, so they deserve real
 * `<a>`s — middle-click, open-in-new-tab and the status bar all come free, and
 * none of them survives an `onClick`. This builds the search string for those;
 * `useWorkspace().show` stays for the cases that are genuinely imperative.
 */
export function workspaceSearch(view: WorkspaceView): string {
  if (view.kind === 'overview') return '';
  const params = new URLSearchParams();
  params.set(VIEW_PARAM, view.kind);
  params.set(ITEM_PARAM, view.id);
  return `?${params.toString()}`;
}
