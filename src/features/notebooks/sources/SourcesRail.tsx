import { FileTextIcon, TypeIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The left rail: what this notebook is built from.
 *
 * ── An honest sources list over a one-document pipeline ───────────────────
 *
 * NotebookLM's rail is the notebook's spine — you add many sources, select a
 * subset, and everything downstream is grounded in exactly that selection.
 * Ours cannot claim that yet. The job pipeline takes **one document per job**
 * (P11 §3) and there is no endpoint that lists a deck's sources, so this rail
 * shows the sources of *this session's* generations and says so.
 *
 * That is a real limitation and the rail is built to state it rather than to
 * imply the feature. Specifically it does **not** render selection checkboxes:
 * a checkbox that appears to scope generation to two of five sources, over a
 * pipeline that reads one document per job, is a control that lies about what
 * the button next to it will do. Checkboxes arrive when fan-out does.
 */

export type NotebookSource = {
  id: string;
  kind: 'document' | 'text';
  title: string;
  /** The job that ingested it, if this session started one. */
  jobId: string | null;
};

export function SourcesRail({
  sources,
  onAddDocument,
  onAddText,
}: {
  sources: NotebookSource[];
  onAddDocument: () => void;
  onAddText: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onAddDocument}
        >
          <FileTextIcon aria-hidden /> Add a PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onAddText}
        >
          <TypeIcon aria-hidden /> Paste text
        </Button>
      </div>

      {sources.length === 0 ? (
        <p className="text-muted-foreground px-3 pb-3 text-xs leading-relaxed">
          Nothing added in this session. Sources you add here become the material
          your cards and exams are generated from.
        </p>
      ) : (
        <ul className="space-y-0.5 px-2 pb-3">
          {sources.map(source => (
            <li key={source.id}>
              <div
                className={cn(
                  'flex items-start gap-2 rounded-md px-2 py-2 text-sm',
                  'hover:bg-accent',
                )}
              >
                {source.kind === 'document' ? (
                  <FileTextIcon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                ) : (
                  <TypeIcon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 break-words">{source.title}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        Stated in the rail itself, not in a tooltip. A user who adds three PDFs
        and expects one deck grounded in all three should find out here rather
        than by inferring it from the cards they get.
      */}
      <p className="text-muted-foreground mt-auto border-t px-3 py-3 text-xs leading-relaxed">
        Each source is generated from on its own. Combining several into one set
        of cards is not built yet.
      </p>
    </div>
  );
}
