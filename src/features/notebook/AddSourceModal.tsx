import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, type AddSourceInput, type SourceKind } from '@/lib/api';
import { useModal } from '@/app/modals';
import { useAddSource } from './queries';

/**
 * Add a source to **this** notebook. FR3 task 2.
 *
 * ═══ The behaviour this replaces ═════════════════════════════════════════
 *
 * Before FR3 there was no way to add a source to an existing notebook. The
 * nearest thing was `/create/text`, which the user reached from a notebook's
 * "Generate cards" button and which **created a new notebook** — so a user
 * adding a second document to their pharmacology notebook ended up with two
 * notebooks called the same thing and their material split across both. The
 * audit called it the single worst behaviour it found. This modal is the fix,
 * and the fix is structural: `notebookId` is a required prop, it comes from the
 * route, and there is no code path here that creates a notebook.
 *
 * ── Three kinds, one discriminated union ─────────────────────────────────
 *
 * `AddSourceInput` is a discriminated union on `kind`, so the tabs are not a
 * cosmetic grouping — each one collects a different shape and the compiler
 * knows which. The document tab is the one with two steps: `requestUpload`
 * gives a presigned PUT, the browser uploads the bytes, and only then does
 * `addSource` reference the resulting `objectKey`. **The fake has nowhere to
 * put bytes**, so it returns a `fake.invalid` URL and accepts the key without
 * reading it — which is honest, and means the upload leg here is written
 * against the contract but has never moved a real file. Said plainly in §7.
 *
 * ── It is a dialog, and it is in the URL ─────────────────────────────────
 *
 * It configures and creates, so by `modals.tsx`'s rule its open-ness is a
 * search param (`?modal=add-source`) and survives a reload. It interrupts, so
 * by FR1's rule it is a `Dialog` rather than a `Sheet`.
 */
export function AddSourceModal({ notebookId }: { notebookId: string }) {
  const { modalProps, closeModal } = useModal();
  const [kind, setKind] = useState<SourceKind>('document');
  const add = useAddSource(notebookId);

  /*
   * One submit path for all three tabs. Each tab builds its own `AddSourceInput`
   * — that is where the union is discriminated — and everything after it is
   * shared: the mutation, the toast, the close.
   */
  const submit = (input: AddSourceInput) => {
    add.mutate(input, {
      onSuccess: () => {
        closeModal();
        /*
         * "Processing" rather than "Added": `addSource` returns a **job**, and
         * the source is not usable until it commits. Saying "Added" here would
         * be the toast contradicting the rail, which still shows the row
         * spinning. FR4 replaces this with the real progress surface.
         */
        toast.success('Source added', {
          description: 'Processing it now — it will be ready shortly.',
        });
      },
      onError: (error: unknown) =>
        toast.error('Could not add the source', {
          description: error instanceof Error ? error.message : 'Unknown error',
        }),
    });
  };

  return (
    <Dialog {...modalProps('add-source')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>
            Everything this notebook generates is built from its sources.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={kind}
          onValueChange={value => {
            setKind(value as SourceKind);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="document">Document</TabsTrigger>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="url">Link</TabsTrigger>
          </TabsList>

          <TabsContent value="document">
            <DocumentTab
              notebookId={notebookId}
              pending={add.isPending}
              onSubmit={submit}
              onCancel={closeModal}
            />
          </TabsContent>

          <TabsContent value="text">
            <TextTab pending={add.isPending} onSubmit={submit} onCancel={closeModal} />
          </TabsContent>

          <TabsContent value="url">
            <UrlTab pending={add.isPending} onSubmit={submit} onCancel={closeModal} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

type TabProps = {
  pending: boolean;
  onSubmit: (input: AddSourceInput) => void;
  onCancel: () => void;
};

/**
 * A document, in two legs: presign, then upload, then reference the key.
 *
 * The upload is `fetch(uploadUrl, { method: 'PUT' })` and nothing more, which
 * is the whole point of a presigned URL — the bytes go straight to object
 * storage and never touch the API. Against the fake that PUT goes to
 * `fake.invalid` and fails, so the failure is caught and reported rather than
 * left to reject unhandled: in fake mode this tab reliably gets as far as the
 * upload and no further, and it says so rather than appearing to hang.
 */
function DocumentTab({
  notebookId,
  pending,
  onSubmit,
  onCancel,
}: TabProps & { notebookId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const busy = pending || uploading;

  const start = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const ticket = await api.requestUpload(notebookId, {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!response.ok) {
        throw new Error(`The upload was rejected (${String(response.status)}).`);
      }

      onSubmit({ kind: 'document', objectKey: ticket.objectKey, title: file.name });
    } catch (error: unknown) {
      toast.error('Could not upload the document', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-base py-base">
      <div className="flex flex-col gap-tight">
        <Label htmlFor="source-file">File</Label>
        <Input
          id="source-file"
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx"
          onChange={event => {
            setFile(event.target.files?.[0] ?? null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          PDF, Word, Markdown or plain text. The title is the file&rsquo;s name.
        </p>
      </div>

      <Footer
        busy={busy}
        disabled={!file}
        label={uploading ? 'Uploading…' : 'Add document'}
        onCancel={onCancel}
        onConfirm={() => {
          void start();
        }}
      />
    </div>
  );
}

/** Pasted text. The one kind with no upload leg and no external fetch. */
function TextTab({ pending, onSubmit, onCancel }: TabProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col gap-base py-base">
      <div className="flex flex-col gap-tight">
        <Label htmlFor="source-title">Title</Label>
        <Input
          id="source-title"
          autoFocus
          placeholder="My notes on aminoglycosides"
          value={title}
          onChange={event => {
            setTitle(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-tight">
        <Label htmlFor="source-text">Text</Label>
        <Textarea
          id="source-text"
          rows={8}
          placeholder="Paste the material here."
          value={text}
          onChange={event => {
            setText(event.target.value);
          }}
        />
      </div>

      <Footer
        busy={pending}
        disabled={title.trim().length === 0 || text.trim().length === 0}
        label="Add text"
        onCancel={onCancel}
        onConfirm={() => {
          onSubmit({ kind: 'text', title: title.trim(), text });
        }}
      />
    </div>
  );
}

/**
 * A link. `title` is optional in the contract — the server falls back to the
 * URL — so the field says so rather than being required for symmetry with the
 * other two tabs.
 */
function UrlTab({ pending, onSubmit, onCancel }: TabProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  return (
    <div className="flex flex-col gap-base py-base">
      <div className="flex flex-col gap-tight">
        <Label htmlFor="source-url">Link</Label>
        <Input
          id="source-url"
          autoFocus
          type="url"
          inputMode="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={event => {
            setUrl(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-tight">
        <Label htmlFor="source-url-title">Title (optional)</Label>
        <Input
          id="source-url-title"
          placeholder="Defaults to the link itself"
          value={title}
          onChange={event => {
            setTitle(event.target.value);
          }}
        />
      </div>

      <Footer
        busy={pending}
        disabled={url.trim().length === 0}
        label="Add link"
        onCancel={onCancel}
        onConfirm={() => {
          const trimmed = title.trim();
          onSubmit({
            kind: 'url',
            url: url.trim(),
            ...(trimmed.length > 0 ? { title: trimmed } : {}),
          });
        }}
      />
    </div>
  );
}

/** The same two buttons on all three tabs, so they cannot drift apart. */
function Footer({
  busy,
  disabled,
  label,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" disabled={busy || disabled} onClick={onConfirm}>
        {busy ? 'Working…' : label}
      </Button>
    </DialogFooter>
  );
}
