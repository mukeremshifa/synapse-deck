import { MessageCircleIcon } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useModal } from '@/app/modals';
import { ChatBody } from './ChatBody';

/**
 * Grounded chat, on demand.
 *
 * ═══ Why chat stopped being the centre of the notebook ═══════════════════
 *
 * It owned **52% of the notebook viewport** while being the most transient
 * thing on screen: the exchanges are `useState([])`, they are gone on refresh
 * and on navigation, and chat **has never answered a real question**, because
 * no embedding key was ever supplied. Meanwhile the Studio — where the actual
 * study material lives — had 26%. ROADMAP.md priority 1 calls that the layout's
 * central mistake, and this is the half of the fix that moves chat out; the
 * other half is `WorkspacePane`, which takes the space.
 *
 * ── Why a sheet, and not a smaller pane ──────────────────────────────────
 *
 * A pane, however narrow, spends screen on chat **at rest** — every notebook,
 * every session, whether or not a question is ever asked. That is the same
 * mistake in smaller type. A sheet costs nothing until it is opened, and it
 * opens wider than a third pane could ever be, which is what an answer with
 * three cited passages actually needs to be readable.
 *
 * `sheet.tsx`'s own rule picks it over a dialog: a dialog *interrupts* and the
 * thing behind it stops mattering; a sheet *accompanies* content that is still
 * the subject. Asking about the source you are reading is exactly that — the
 * workspace stays where it was, and the selection you had is still there when
 * you close.
 *
 * ── It is in the URL, like every other modal ─────────────────────────────
 *
 * `?modal=chat`. By `modals.tsx`'s test a modal that *configures* belongs in
 * the URL and one that *confirms* does not: which sources ground an answer is a
 * real choice the user makes, back should close the sheet rather than leave the
 * notebook, and "open this notebook with chat up" is worth being able to send
 * someone. The transcript itself is still not persisted — that is undecided at
 * the contract level, not something this surface can settle.
 */
export function ChatSheet({
  notebookId,
  selectedIds,
  readySourceCount,
}: {
  notebookId: string;
  selectedIds: ReadonlySet<string>;
  readySourceCount: number;
}) {
  const { modalProps } = useModal();

  return (
    <Sheet {...modalProps('chat')}>
      {/*
        Wider than the default `max-w-md`. An answer carries cited passages
        under it, and a citation excerpt wrapped to forty characters is a
        column of fragments rather than a quotation you can read.
      */}
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="gap-tight flex items-center pr-6">
            <MessageCircleIcon className="text-muted-foreground size-4" aria-hidden />
            Chat
          </SheetTitle>
          {/*
            Which sources an answer will be grounded in, stated in words. The
            contract's comment is explicit that an empty `sourceIds` means every
            ready source — "a choice the UI makes explicit, not a default the
            server invents" — so a user who selected two of five and forgot does
            not have to infer it from the answer.
          */}
          <SheetDescription>
            {readySourceCount === 0
              ? 'No sources are ready, so there is nothing to draw on yet.'
              : selectedIds.size > 0
                ? `Grounded in the ${String(selectedIds.size)} source${selectedIds.size === 1 ? '' : 's'} selected in the rail.`
                : `Grounded in all ${String(readySourceCount)} ready source${readySourceCount === 1 ? '' : 's'}.`}
          </SheetDescription>
        </SheetHeader>

        {/*
          `ChatBody` is the transcript and the composer with no chrome of its
          own — split from the old pane the same way `SourceBody` was split from
          this sheet's predecessor, so the conversation surface has exactly one
          implementation.

          **The exchanges live inside it, so closing the sheet loses them.**
          That is not new and not this file's decision: the transcript was
          already component state that reset on navigation, because the contract
          has no noun for a chat turn. It is written up in `ChatBody`.
        */}
        <ChatBody
          notebookId={notebookId}
          selectedIds={selectedIds}
          readySourceCount={readySourceCount}
        />
      </SheetContent>
    </Sheet>
  );
}
