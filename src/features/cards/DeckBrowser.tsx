import { useParams } from 'react-router-dom';

import { FocusFrame } from '@/app/FocusFrame';
import { notebookPath } from '@/lib/notebooks';
import { useArtifact } from '@/features/study/queries';
import { DeckBody } from './DeckBody';

/**
 * `/notebooks/:notebookId/decks/:deckId/cards` — **the deck, opened to look at
 * rather than to be graded by.**
 *
 * ═══ Why this screen exists ══════════════════════════════════════════════
 *
 * Until it was built a user met their cards **one at a time, during review,
 * with no way to change one.** A hallucinated card was permanent: the only
 * thing you could do with a wrong answer was keep being asked it. `CardEditor`
 * had existed since P8 and `updateCard` since FR0, and neither had a screen —
 * the editor was mounted by nothing at all.
 *
 * ── Why not in the review runner ─────────────────────────────────────────
 *
 * Because `PracticeSession.tsx:47` is right:
 *
 * > Editing mid-review is also the one moment the user is least able to judge a
 * > card fairly.
 *
 * Mid-review you are not reading the card, you are failing it, and "this card
 * is badly worded" and "I do not know this" feel identical from inside. So the
 * editor lives where browsing is the activity and nothing is being scored, and
 * the runner keeps no edit button. That is settled in ROADMAP.md.
 *
 * ── This file is now the frame, and `DeckBody` is the list ───────────────
 *
 * The same list also renders inside the notebook's workspace pane, so it moved
 * to `DeckBody.tsx` and this route supplies the full-screen chrome around it.
 * The two decisions the list carries — a splitting edit keeps the original's
 * schedule, and delete confirms while suspend does not — are documented there,
 * with the code they govern.
 *
 * **Both surfaces are kept.** The workspace is where you fix a card without
 * leaving the notebook; this route is what a bookmark points at, and editing a
 * deck of two hundred cards wants the width.
 */
export function DeckBrowser() {
  const { notebookId, deckId } = useParams<{ notebookId: string; deckId: string }>();

  // The route cannot match without both. This is the narrowing that lets
  // everything below require them rather than threading `string | undefined`.
  if (!notebookId || !deckId) return null;

  return <Browser notebookId={notebookId} deckId={deckId} />;
}

function Browser({ notebookId, deckId }: { notebookId: string; deckId: string }) {
  /*
   * Read only for the subtitle. `DeckBody` fetches the same artifact and does
   * its own wrong-kind and not-ready handling — this is one cached query with
   * two subscribers, not two requests, and the alternative was passing a title
   * down into a component whose whole point is that it reads its own data.
   */
  const artifact = useArtifact(notebookId, deckId);

  return (
    <FocusFrame
      title="Cards"
      {...(artifact.data ? { subtitle: artifact.data.title } : {})}
      exitTo={notebookPath.open(notebookId)}
      width="wide"
    >
      <DeckBody notebookId={notebookId} deckId={deckId} />
    </FocusFrame>
  );
}
