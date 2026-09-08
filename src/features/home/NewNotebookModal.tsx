import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Textarea } from '@/components/ui/textarea';
import { api, CreateNotebookInput } from '@/lib/api';
import { useModal } from '@/app/modals';
import { homeKeys } from './queries';

/**
 * Create a notebook. The one modal FR2 builds.
 *
 * ── Why this is not scope creep ───────────────────────────────────────────
 *
 * The plan's §2 is explicit that FR2 builds the modal *system*, not any
 * particular modal, and FR3/FR4 own the interesting ones (add a source,
 * generate an artifact). This one is built anyway, for two reasons that do not
 * generalise to the others:
 *
 * 1. **Task 5 requires the app to work.** Home's primary action is "new
 *    notebook". Shipping it inert would leave a signed-in user with four
 *    fixtures and no way to make a fifth — and the flow that used to create one
 *    (`/create/text`) is deleted by task 1, along with the page that hosted the
 *    old form.
 * 2. **A system with no consumer is unverified twice over.** `modals.tsx` makes
 *    claims about escape, focus, the back gesture and reload survival. There
 *    are no tests here; the only thing that can check those claims is a modal
 *    that actually opens. FR3 should not be the phase that discovers the
 *    system does not work.
 *
 * It is a *decision*, in brief §3.2's sense — it configures and creates — so by
 * `modals.tsx`'s own rule it belongs in the URL, and it is a **dialog** rather
 * than a sheet by FR1's: it interrupts, the page behind it stops mattering
 * until it is answered.
 *
 * ── It is deliberately the smallest form that works ──────────────────────
 *
 * A title and an optional description, ported from `NotebookListPage`'s
 * inline create form, which task 1 deletes with the page. Everything else a
 * notebook might want configured at birth belongs to the notebook itself, and
 * `notebook-settings` is already reserved in `ModalName` for FR3.
 */
export function NewNotebookModal() {
  const { modalProps, closeModal } = useModal();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const form = useForm<CreateNotebookInput>({
    resolver: zodResolver(CreateNotebookInput),
    defaultValues: { title: '', description: '' },
  });

  const create = useMutation({
    mutationFn: (input: CreateNotebookInput) => api.createNotebook(input),
    onSuccess: async notebook => {
      await queryClient.invalidateQueries({ queryKey: homeKeys.notebooks });
      form.reset();
      closeModal();
      /*
       * Straight into the new notebook. An empty one is useless until a source
       * is added and the add-source control lives inside it — the same
       * reasoning `NotebookListPage` used, and brief §3.3 makes "+ Add source"
       * the notebook's primary CTA, so this lands the user on it.
       */
      void navigate(`/notebooks/${notebook.id}`);
    },
    onError: (error: unknown) =>
      toast.error('Could not create the notebook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      }),
  });

  return (
    <Dialog {...modalProps('new-notebook')}>
      <DialogContent>
        <form
          onSubmit={form.handleSubmit(values => {
            create.mutate(values);
          })}
        >
          <DialogHeader>
            <DialogTitle>New notebook</DialogTitle>
            <DialogDescription>
              A notebook holds your sources and everything generated from them.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-base py-base">
            <div className="flex flex-col gap-tight">
              <Label htmlFor="notebook-title">Title</Label>
              <Input
                id="notebook-title"
                autoFocus
                placeholder="Pharmacology — week 3"
                {...form.register('title')}
              />
              {form.formState.errors.title && (
                <p className="text-destructive text-sm">
                  {form.formState.errors.title.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-tight">
              <Label htmlFor="notebook-description">Description (optional)</Label>
              <Textarea
                id="notebook-description"
                rows={2}
                placeholder="What this covers."
                {...form.register('description')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create notebook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
