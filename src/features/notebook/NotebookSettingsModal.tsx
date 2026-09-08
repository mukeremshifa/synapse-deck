import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useModal } from '@/app/modals';
import { homeKeys } from '@/features/home/queries';
import { notebookKeys, useNotebook } from './queries';

/**
 * `?modal=notebook-settings` — rename a notebook, or delete it.
 *
 * The third of the three names FR2 reserved in `ModalName` for FR3. It is small
 * on purpose: a notebook is a title, a description, and its contents, so there
 * is nothing else here to configure. Everything a user might expect to find in
 * "settings" — what gets generated, how many cards, how long an exam runs — is
 * a property of an **artifact** rather than of the notebook, and belongs to the
 * generate modal FR4 builds.
 *
 * ── Deleting is a confirmation, so it is local state ─────────────────────
 *
 * `modals.tsx` draws the line and this file sits exactly on it: the settings
 * modal *configures*, so it lives in the URL; the delete confirmation
 * *interrupts*, so it does not. A pasted link that reopened "about to delete
 * your notebook" would be a prompt to destroy something the user never asked
 * about in this session.
 *
 * Deleting a notebook takes its sources and artifacts with it — unlike deleting
 * a *source*, which deliberately leaves artifacts standing (brief §1.2(7)). The
 * difference is worth stating in the dialog, because the two deletes sit two
 * clicks apart and behave oppositely.
 */
export function NotebookSettingsModal({ notebookId }: { notebookId: string }) {
  const { modalProps, closeModal, open } = useModal();
  const notebook = useNotebook(notebookId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [confirming, setConfirming] = useState(false);

  /*
   * Seed the fields when the modal opens, not on every render of the notebook.
   * The query refetches — home invalidates it, and the source poll runs beside
   * it — and re-seeding on every result would wipe out what the user is
   * currently typing.
   */
  const isOpen = open === 'notebook-settings';
  useEffect(() => {
    if (isOpen && notebook.data) {
      setTitle(notebook.data.title);
      setDescription(notebook.data.description ?? '');
    }
  }, [isOpen, notebook.data]);

  const save = useMutation({
    mutationFn: () =>
      api.updateNotebook(notebookId, {
        title: title.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) }),
        queryClient.invalidateQueries({ queryKey: homeKeys.notebooks }),
      ]);
      closeModal();
      toast.success('Notebook updated');
    },
    onError: (error: unknown) =>
      toast.error('Could not save the notebook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      }),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteNotebook(notebookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: homeKeys.notebooks });
      setConfirming(false);
      closeModal();
      // Home, because the place the user is standing has just ceased to exist.
      void navigate('/');
      toast.success('Notebook deleted');
    },
    onError: (error: unknown) =>
      toast.error('Could not delete the notebook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      }),
  });

  return (
    <Dialog {...modalProps('notebook-settings')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notebook settings</DialogTitle>
          <DialogDescription>
            What this notebook is called, and what it covers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-base py-base">
          <div className="flex flex-col gap-tight">
            <Label htmlFor="notebook-settings-title">Title</Label>
            <Input
              id="notebook-settings-title"
              value={title}
              onChange={event => {
                setTitle(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-tight">
            <Label htmlFor="notebook-settings-description">Description</Label>
            <Textarea
              id="notebook-settings-description"
              rows={2}
              placeholder="What this covers."
              value={description}
              onChange={event => {
                setDescription(event.target.value);
              }}
            />
          </div>

          <div className="border-destructive/40 flex items-center gap-snug rounded-md border border-dashed p-snug">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Delete this notebook</p>
              <p className="text-muted-foreground text-xs">
                Its sources and everything generated from them go with it.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            disabled={title.trim().length === 0 || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete "${notebook.data?.title ?? 'this notebook'}"?`}
        description="Its sources, cards, quizzes, notes and exams are deleted with it. This cannot be undone."
        confirmLabel="Delete notebook"
        confirming={remove.isPending}
        onConfirm={() => {
          remove.mutate();
        }}
      />
    </Dialog>
  );
}
