import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArtifactKind } from '@/lib/api';
import { useModal } from '@/app/modals';

/**
 * `?modal=generate` — **the entry point FR4 fills in.**
 *
 * ═══ Why this exists instead of the real modal ═══════════════════════════
 *
 * The plan names this as FR3's trap, in as many words:
 *
 * > Studio lists artifacts, and an artifact list makes you want to build the
 * > generate modal. Empty Studio entries open a modal that FR4 fills — a
 * > documented "FR4 builds this" is complete for FR3.
 *
 * So this is the seam, and it is a real one rather than a dead button: the
 * modal opens, it is addressable at `?modal=generate&kind=quiz`, the kind
 * survives a reload, and it says plainly what happens next. Everything FR4
 * needs to replace is behind one component.
 *
 * ── The handoff, concretely ──────────────────────────────────────────────
 *
 * FR4 replaces this file with the real modal. What it is given:
 *
 * - **The param contract.** `?modal=generate` with `kind` set to an
 *   `ArtifactKind`. Studio's five entries open it (four kinds; Diagnostics is a
 *   view and opens FR6's overview instead), and `kind` is validated below
 *   rather than trusted — a hand-typed `?kind=nonsense` shows the fallback
 *   rather than throwing, per `modals.tsx`'s rule that modal params are
 *   user-editable text.
 * - **What it must collect**: `CreateArtifactInput` for that kind — the
 *   discriminated union in the contract. Every variant needs `title` and
 *   `sourceIds`, and `sourceIds` must come from *this* notebook's sources
 *   (brief §1.2(6): the server rejects foreign ids rather than dropping them).
 * - **What it returns**: a `Job`, like `addSource`. The artifact appears in
 *   Studio at `status: 'generating'` — a real, listable, unopenable row — and
 *   `useArtifacts` already polls while one is in flight. FR3's minimal pending
 *   state is that poll; **FR4 replaces it** with the progress surface over
 *   `getJob`, and FR0's drift row names the case to design first: a job that
 *   fails before any stage reports, with `unitsTotal` still 0.
 */
export function GenerateModalPlaceholder() {
  const { modalProps, modalParam, closeModal } = useModal();

  // Never trusted: a modal's params are user-editable text.
  const parsed = ArtifactKind.safeParse(modalParam('kind'));
  const kind = parsed.success ? parsed.data : null;

  return (
    <Dialog {...modalProps('generate')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind ? LABELS[kind] : 'Generate'}</DialogTitle>
          <DialogDescription>
            Generation is built in FR4. This is the entry point it fills — the
            modal, its address and the kind it was opened for all work; what is
            missing is the form and the job progress behind it.
          </DialogDescription>
        </DialogHeader>

        <p className="text-muted-foreground py-base text-sm leading-relaxed">
          {kind
            ? `Choosing sources, a count and a depth, then watching the job run, is FR4's work. Until then, this notebook's existing ${LABELS[kind].toLowerCase()} are listed in the Studio.`
            : 'This modal was opened without a valid kind, so there is nothing to configure.'}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={closeModal}>
            Close
          </Button>
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Studio's labels, which are the user's words for the four kinds. */
const LABELS: Record<ArtifactKind, string> = {
  deck: 'Cards',
  quiz: 'Quiz',
  noteset: 'Notes',
  exam: 'Exam',
};
