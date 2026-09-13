import {
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  TriangleAlertIcon,
  TypeIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states';
import type { Source, SourceKind } from '@/lib/api';
import { useProfile } from '@/features/settings/queries';
import { formatDate } from '@/lib/format';
import { resolveTimeZone } from '@/lib/day';
import { useSourceContent } from './queries';

/**
 * A source, opened and read.
 *
 * ═══ Why this is a sheet, and what item 4 should do with it ══════════════
 *
 * **It is a sheet because the workspace pane does not exist yet.** The planned
 * home for this is the notebook's centre column — a workspace showing whatever
 * is selected, with chat demoted from the 52% it currently owns. That is the
 * layout restructure, it is the largest item on the roadmap, and building this
 * viewer into a pane that has not been built would have meant writing it twice.
 *
 * So it is deliberately **self-contained**: it takes a source id and an
 * open/close pair, owns no layout, and reads its own data. Moving it into the
 * workspace pane should be a matter of rendering `<SourceBody>` somewhere else
 * and dropping the `Sheet` wrapper — the body below is written as a separate
 * component for exactly that reason, and nothing in it knows it is in a sheet.
 *
 * A sheet is also the honest interim choice rather than a dialog: `sheet.tsx`
 * says a sheet "accompanies" while a dialog "interrupts", and reading a source
 * accompanies the notebook you are working in. You can close it and the
 * selection you had is still there.
 *
 * ── The text is untrusted, and is rendered as text ───────────────────────
 *
 * Extracted document text is no more trustworthy than model output: it comes
 * from a file the user uploaded or a URL the pipeline fetched. It renders into
 * a `<pre>` with `whitespace-pre-wrap`, never `dangerouslySetInnerHTML` — which
 * is blocked by an eslint rule anyway, and that rule is the backstop rather
 * than the intent.
 */
export function SourceViewer({
  notebookId,
  source,
  open,
  onOpenChange,
}: {
  notebookId: string;
  source: Source | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl">
        {source && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-tight pr-6">
                <SourceKindIcon kind={source.kind} />
                <span className="min-w-0 truncate">{source.title}</span>
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-tight text-xs">
                  <StatusBadge source={source} />
                  {source.topicNames.slice(0, 4).map(topic => (
                    <Badge key={topic} variant="outline" className="shrink-0">
                      {topic}
                    </Badge>
                  ))}
                  {source.topicNames.length > 4 && (
                    <span className="text-muted-foreground">
                      +{String(source.topicNames.length - 4)} more
                    </span>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            <SourceBody notebookId={notebookId} source={source} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The readable part: the extracted text, and what to say when there is none.
 *
 * **Kept separate from the sheet on purpose** — see the note above. Item 4
 * moves this into the workspace pane by rendering it there; it knows nothing
 * about the surface it sits on.
 */
export function SourceBody({
  notebookId,
  source,
}: {
  notebookId: string;
  source: Source;
}) {
  const { data: profile } = useProfile();
  const content = useSourceContent(notebookId, source.id, source.status === 'ready');

  // A source that is still being read, or one that could not be read, has no
  // text and never will — so this says which, rather than showing an empty
  // reader and letting the user wonder whether it is still loading.
  if (source.status !== 'ready') {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col justify-center gap-tight text-center text-sm">
        {source.status === 'processing' ? (
          <>
            <Loader2Icon className="mx-auto size-5 animate-spin" aria-hidden />
            <p>This source is still being read.</p>
            <p className="text-xs">Its text will be here once the pipeline finishes.</p>
          </>
        ) : (
          <>
            <TriangleAlertIcon className="text-destructive mx-auto size-5" aria-hidden />
            <p>This source could not be read.</p>
            {/* `error` is pipeline output and is rendered as text. */}
            <p className="text-xs">{source.error ?? 'No reason was recorded.'}</p>
          </>
        )}
      </div>
    );
  }

  if (content.isError) {
    return (
      <ErrorState
        title="Could not load this source"
        detail={content.error.message}
        onRetry={() => void content.refetch()}
      />
    );
  }

  if (content.isPending) {
    return (
      <div className="flex flex-col gap-tight">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }

  const text = content.text;
  const total = content.totalChars;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-tight">
      <div className="text-muted-foreground flex items-baseline gap-tight text-xs">
        <span className="tabular-nums">
          {total === 0
            ? 'No text was extracted'
            : `${new Intl.NumberFormat().format(total)} characters`}
        </span>
        <span className="ml-auto">
          Added {formatDate(new Date(source.createdAt), resolveTimeZone(profile?.timezone))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-snug">
        {/*
          Untrusted extracted text, rendered as text. `whitespace-pre-wrap`
          keeps the document's own paragraphing without letting a long line
          push the sheet sideways.
        */}
        <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
          {text}
        </pre>

        {content.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="mt-snug w-full"
            disabled={content.isFetchingNextPage}
            onClick={() => {
              void content.fetchNextPage();
            }}
          >
            {content.isFetchingNextPage ? 'Loading…' : 'Read more'}
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ source }: { source: Source }) {
  if (source.status === 'processing') {
    return (
      <Badge variant="secondary" className="shrink-0">
        Processing
      </Badge>
    );
  }
  if (source.status === 'failed') {
    return (
      <Badge variant="destructive" className="shrink-0">
        Failed
      </Badge>
    );
  }
  return null;
}

const KIND_ICON: Record<SourceKind, typeof FileTextIcon> = {
  document: FileTextIcon,
  text: TypeIcon,
  url: GlobeIcon,
};

function SourceKindIcon({ kind }: { kind: SourceKind }) {
  const Icon = KIND_ICON[kind];
  return <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />;
}
