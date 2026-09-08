import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The modal system — how a modal opens, closes, stacks, and where its open-ness
 * lives. FR2 task 3.
 *
 * FR3 and FR4 build the actual modals (add a source, generate an artifact, the
 * card editor, notebook settings). This file is the one way they all do it, so
 * that four modals do not arrive with four conventions.
 *
 * ═══ The decision: modals are in the URL ═════════════════════════════════
 *
 * A modal's open-ness is a search parameter — `?modal=generate&kind=quiz` —
 * not `useState`. Recorded as FR2 §6.1. The argument, because a later session
 * will be tempted to "simplify" this back to local state:
 *
 * 1. **Brief §3.2 makes modals the primary verb.** Adding a source and
 *    generating an artifact are the two things this product is *for*. With
 *    local state, the app's main actions are the only things in it that cannot
 *    be linked to, and "open a notebook and generate a quiz" is not expressible
 *    as an address.
 * 2. **Reload is not data loss.** A generate modal with sources chosen and a
 *    count set, dismissed by a refresh, is the kind of small betrayal that
 *    teaches users not to trust a form. The URL survives a reload.
 * 3. **Back closes it, for free.** Users expect the back gesture to dismiss an
 *    overlay — on Android it is *the* dismiss gesture. Local state makes back
 *    leave the page instead, which is the worse failure and the harder one to
 *    add later.
 *
 * The cost, stated plainly: a modal's parameters are user-editable text. So
 * `useModal` **never trusts them** — an unknown `modal` value reads as closed
 * rather than throwing, and every consumer validates its own params the way it
 * would validate any input. A hand-typed `?modal=nonsense` shows the page.
 *
 * ── What stays local state, and why that is not an inconsistency ──────────
 *
 * **A confirmation does not go in the URL.** `ConfirmDialog` ("delete this
 * notebook?") stays exactly as it is. The test is the one brief §3.2 already
 * draws: a route is *a place you can be, link to, and return to*. You can be in
 * "generating a quiz"; you cannot be in "about to confirm a delete" — a
 * confirmation restored from a pasted link is a prompt to destroy something the
 * user never asked about in this session. Same reason a toast is not a route.
 *
 * So: **a modal that configures or creates goes in the URL. A modal that
 * confirms or interrupts does not.** That maps exactly onto FR1's dialog/sheet
 * rule — dialogs that interrupt are transient, surfaces you work in are places.
 *
 * ── Stacking ─────────────────────────────────────────────────────────────
 *
 * One modal at a time, deliberately. `openModal` replaces whatever is open
 * rather than layering, because two overlays make focus containment ambiguous
 * and there is no product reason here to nest one. A modal that needs a
 * sub-decision uses `ConfirmDialog` on top — that is a confirmation, which by
 * the rule above is local state, and Radix handles the nesting.
 *
 * ── Focus, escape and scroll lock ────────────────────────────────────────
 *
 * All three are Radix's, unchanged: `Dialog`/`Sheet` trap focus, restore it to
 * the trigger on close, close on Escape and on an overlay click, and lock body
 * scroll while open. Nothing here reimplements them — the system's job is
 * *which* modal is open, not how an overlay behaves. Overlay motion is FR1's
 * `ui-overlay` / `ui-panel` / `ui-sheet` classes; there is no
 * `tailwindcss-animate` in this repo.
 */

/** The name of the search param that carries which modal is open. */
const MODAL_PARAM = 'modal';

/**
 * The params the open modal brought with it, so `closeModal` can remove them.
 *
 * **Added by FR4, which is where the leak became visible.** `openModal` has
 * always accepted extra params — `?modal=generate&kind=quiz` — and `closeModal`
 * only ever deleted `modal`, so closing a modal left its parameters behind on
 * a URL that no longer means anything by them. FR3's placeholder never exposed
 * it because nothing closed a modal that had been opened with params.
 *
 * Deliberately a param rather than a `useRef`: the modal system's whole premise
 * is that the URL is the state. A ref would be empty after a reload, so a modal
 * restored from a pasted link would still leak its params on close — which is
 * precisely the case the URL approach exists to serve. Being in the URL means
 * the cleanup survives exactly as the modal does.
 *
 * A pasted link that omits it (a hand-typed `?modal=generate&kind=quiz`) simply
 * leaves `kind` behind on close. That is the honest limit of not being able to
 * know what a param was for, and it is a stale query string rather than a
 * broken screen — `kind` is read only while `modal=generate` is set.
 */
const OWNED_PARAM = 'modalParams';

/**
 * Every modal in the app, by name.
 *
 * A closed union rather than a free string, so a typo in `openModal('genrate')`
 * is a compile error instead of a modal that never opens. **FR3 and FR4 add
 * their names here** — that is the intended way to extend this, and the list
 * doubles as the inventory of what the app can be in the middle of.
 */
export type ModalName =
  /** FR2: create a notebook. The one modal this phase builds — see `NewNotebookModal`. */
  | 'new-notebook'
  /** FR4: generate an artifact from this notebook's sources. */
  | 'generate'
  /** FR3: add a source to this notebook. */
  | 'add-source'
  /** FR3: edit one card. */
  | 'edit-card'
  /** FR3: this notebook's settings. */
  | 'notebook-settings';

const MODAL_NAMES: readonly ModalName[] = [
  'new-notebook',
  'generate',
  'add-source',
  'edit-card',
  'notebook-settings',
];

function isModalName(value: string | null): value is ModalName {
  return value !== null && (MODAL_NAMES as readonly string[]).includes(value);
}

export interface ModalController {
  /** Which modal is open, or null. An unrecognised param reads as null. */
  readonly open: ModalName | null;
  /**
   * Open a modal, optionally with parameters of its own — `openModal('generate',
   * { kind: 'quiz' })` gives `?modal=generate&kind=quiz`.
   *
   * Pushes a history entry, so the back gesture closes it. Replaces any modal
   * already open rather than stacking.
   */
  openModal: (name: ModalName, params?: Record<string, string>) => void;
  /** Close whatever is open. Replaces the entry, so back does not reopen it. */
  closeModal: () => void;
  /**
   * `open` / `onOpenChange` for a Radix `Dialog` or `Sheet`, bound to one name:
   *
   *     <Dialog {...modalProps('generate')}>
   *
   * The indirection earns its place by making the dismissal paths — Escape, the
   * overlay, the close button — all route through `closeModal`, so none of them
   * can leave a stale param in the URL.
   */
  modalProps: (name: ModalName) => {
    open: boolean;
    onOpenChange: (next: boolean) => void;
  };
  /** A modal's own parameters, e.g. the `cardId` an editor was opened for. */
  modalParam: (key: string) => string | null;
}

const ModalContext = createContext<ModalController | null>(null);

/**
 * Reads and writes the modal state in the URL.
 *
 * Mounted once, inside the router (it needs `useSearchParams`) and above every
 * route that opens a modal. `providers.tsx` does not host it, because that sits
 * outside `BrowserRouter`.
 */
export function ModalProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();

  const raw = params.get(MODAL_PARAM);
  const open = isModalName(raw) ? raw : null;

  const openModal = useCallback(
    (name: ModalName, extra?: Record<string, string>) => {
      const next = new URLSearchParams(params);
      next.set(MODAL_PARAM, name);
      const keys = Object.keys(extra ?? {});
      for (const [key, value] of Object.entries(extra ?? {})) next.set(key, value);
      /*
       * Record which params belong to this modal, so closing can take them away
       * again. Without it they outlive the modal: FR4's generate modal opens
       * with `?modal=generate&kind=quiz`, and closing left `?kind=quiz` on the
       * notebook for ever — a URL the user would then share, or reload into,
       * carrying a parameter that means nothing to the page. Found in a browser.
       */
      if (keys.length > 0) next.set(OWNED_PARAM, keys.join(','));
      else next.delete(OWNED_PARAM);
      // A push, so back closes the modal rather than leaving the page.
      setParams(next);
    },
    [params, setParams],
  );

  const closeModal = useCallback(() => {
    const next = new URLSearchParams(params);
    // Everything the modal brought with it goes when the modal does.
    for (const key of (params.get(OWNED_PARAM) ?? '').split(',')) {
      if (key !== '') next.delete(key);
    }
    next.delete(OWNED_PARAM);
    next.delete(MODAL_PARAM);
    /*
     * `replace`, and the asymmetry with `openModal` is the point: opening
     * pushes so back can close, and closing replaces so back does not *reopen*
     * what the user just dismissed. Pushing on both would make the back button
     * toggle the modal forever.
     */
    setParams(next, { replace: true });
  }, [params, setParams]);

  const value = useMemo<ModalController>(
    () => ({
      open,
      openModal,
      closeModal,
      modalProps: (name: ModalName) => ({
        open: open === name,
        onOpenChange: (next: boolean) => {
          if (!next) closeModal();
        },
      }),
      modalParam: (key: string) => params.get(key),
    }),
    [open, openModal, closeModal, params],
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

/**
 * The modal system, for a component that opens or renders one.
 *
 * Throws outside the provider rather than returning a no-op controller: a
 * silently inert `openModal` is a button that does nothing, which is the
 * hardest kind of bug to see.
 */
export function useModal(): ModalController {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used inside <ModalProvider>.');
  }
  return context;
}
