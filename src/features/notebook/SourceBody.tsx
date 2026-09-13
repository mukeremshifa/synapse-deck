import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states';
import type { Source } from '@/lib/api';
import { useProfile } from '@/features/settings/queries';
import { formatDate } from '@/lib/format';
import { resolveTimeZone } from '@/lib/day';
import { useSourceContent } from './queries';

/**
 * A source, read.
 *
 * ═══ The sheet is gone; this is the body that outlived it ════════════════
 *
 * This file used to export a `SourceViewer` — a right-hand `Sheet` that
 * `SourcesPane` mounted and opened from a source's title. That was always an
 * interim: the sheet's own note said the planned home was the notebook's centre
 * column, that it was built to be moved, and that moving it should be "a matter
 * of rendering `<SourceBody>` somewhere else and dropping the `Sheet` wrapper".
 *
 * **That is exactly what the layout restructure did.** `WorkspacePane` renders
 * this, the wrapper is deleted, and the prediction held: nothing in the body
 * changed, because nothing in it knew it was in a sheet. The sheet is not kept
 * "just in case" — two surfaces for reading one source is the drift the split
 * was designed to avoid.
 *
 * ── The text is untrusted, and is rendered as text ───────────────────────
 *
 * Extracted document text is no more trustworthy than model output: it comes
 * from a file the user uploaded or a URL the pipeline fetched. It renders into
 * a `<pre>` with `whitespace-pre-wrap`, never `dangerouslySetInnerHTML` — which
 * is blocked by an eslint rule anyway, and that rule is the backstop rather
 * than the intent.
 */

/**
 * The readable part: the extracted text, and what to say when there is none.
 *
 * It owns no layout and knows nothing about the surface it sits on — it takes a
 * source and reads its own content. That is what let the workspace adopt it
 * unchanged, and it is why it stays this way.
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
      {/*
        The topics this source was tagged with. They were in the sheet's header
        before the restructure; they belong with the document rather than with
        the frame, so they moved into the body with it.
      */}
      {source.topicNames.length > 0 && (
        <div className="gap-tight flex flex-wrap">
          {source.topicNames.slice(0, 6).map(topic => (
            <Badge key={topic} variant="outline" className="shrink-0">
              {topic}
            </Badge>
          ))}
          {source.topicNames.length > 6 && (
            <span className="text-muted-foreground text-xs">
              +{String(source.topicNames.length - 6)} more
            </span>
          )}
        </div>
      )}

      <div className="text-muted-foreground gap-tight flex items-baseline text-xs">
        <span className="tabular-nums">
          {total === 0
            ? 'No text was extracted'
            : `${new Intl.NumberFormat().format(total)} characters`}
        </span>
        <span className="ml-auto">
          Added{' '}
          {formatDate(new Date(source.createdAt), resolveTimeZone(profile?.timezone))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-snug">
        {/*
          Untrusted extracted text, rendered as text. `whitespace-pre-wrap`
          keeps the document's own paragraphing without letting a long line
          push the pane sideways.
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
