/**
 * The mobile choice sheets: <DialogsProvider/> shows the unsaved-changes sheet and the commit-conflict sheet and
 * useDialogs() hands { confirmUnsaved, confirmConflict } (promises of the user's choice) to the document session
 * and the GitHub controller. Strings, roles and choices are those of the desktop UnsavedChangesDialog.tsx and
 * ConflictDialog.tsx; only the layout differs (a bottom sheet, stacked 44px buttons). Tapping the scrim, like Escape on
 * desktop, answers Cancel. Questions asked while one is open wait their turn.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConflictChoice, UnsavedChoice } from '@gonq/editor/controllers/document';

export interface Dialogs {
  confirmUnsaved(name: string): Promise<UnsavedChoice>;
  confirmConflict(conflict: { name: string; deleted: boolean }): Promise<ConflictChoice>;
}

type Question =
  | { id: number; kind: 'unsaved'; name: string; answer(c: UnsavedChoice): void }
  | { id: number; kind: 'conflict'; name: string; deleted: boolean; answer(c: ConflictChoice): void };
type Ask = { [K in Question['kind']]: Omit<Extract<Question, { kind: K }>, 'id' | 'answer'> }[Question['kind']];

const DialogsContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const d = useContext(DialogsContext);
  if (!d) throw new Error('useDialogs needs a <DialogsProvider>');
  return d;
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Question[]>([]);
  const nextId = useRef(0);
  const ask = useCallback(<R,>(question: Ask) => {
    return new Promise<R>((resolve) => {
      const id = nextId.current++;
      const answer = (r: R) => {
        setQueue((q) => q.filter((x) => x.id !== id));
        resolve(r);
      };
      setQueue((q) => [...q, { ...question, id, answer } as Question]);
    });
  }, []);
  const value = useMemo<Dialogs>(
    () => ({
      confirmUnsaved: (name) => ask<UnsavedChoice>({ kind: 'unsaved', name }),
      confirmConflict: ({ name, deleted }) => ask<ConflictChoice>({ kind: 'conflict', name, deleted }),
    }),
    [ask],
  );
  const current = queue[0];
  return (
    <DialogsContext.Provider value={value}>
      {children}
      {current?.kind === 'unsaved' && <UnsavedSheet key={current.id} name={current.name} onChoose={current.answer} />}
      {current?.kind === 'conflict' && <ConflictSheet key={current.id} name={current.name} deleted={current.deleted} onChoose={current.answer} />}
    </DialogsContext.Provider>
  );
}

/** A modal sheet from the bottom edge; the scrim is a backdrop (not a control) that answers Cancel. */
function ChoiceSheet({ titleId, title, body, onCancel, children }: { titleId: string; title: string; body: string; onCancel(): void; children: ReactNode }) {
  return (
    <>
      <div className="m-scrim" data-testid="choice-scrim" onClick={onCancel} />
      <section className="m-sheet m-choice" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="m-choice-title">
          {title}
        </h2>
        <p className="m-choice-body">{body}</p>
        {children}
      </section>
    </>
  );
}

function UnsavedSheet({ name, onChoose }: { name: string; onChoose(c: UnsavedChoice): void }) {
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => save.current?.focus(), []);
  return (
    <ChoiceSheet titleId="unsaved-title" title={`Save changes to ${name}?`} body="Your changes will be lost if you don’t save them." onCancel={() => onChoose('cancel')}>
      <button type="button" ref={save} className="m-tap m-tap-primary m-block" onClick={() => onChoose('save')}>
        Save
      </button>
      <button type="button" className="m-tap m-block m-destructive" onClick={() => onChoose('discard')}>
        Don’t save
      </button>
      <button type="button" className="m-tap m-block m-outline" onClick={() => onChoose('cancel')}>
        Cancel
      </button>
    </ChoiceSheet>
  );
}

function ConflictSheet({ name, deleted, onChoose }: { name: string; deleted: boolean; onChoose(c: ConflictChoice): void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const title = deleted ? `${name} was deleted on the server since you opened it.` : `${name} changed on the server since you opened it.`;
  const body = `${deleted ? 'Overwrite writes your version back as a new file.' : 'Overwrite replaces the server’s version with yours.'} Cancel keeps your changes unsaved.`;
  return (
    <ChoiceSheet titleId="conflict-title" title={title} body={body} onCancel={() => onChoose('cancel')}>
      <button type="button" ref={cancel} className="m-tap m-block m-outline" onClick={() => onChoose('cancel')}>
        Cancel
      </button>
      <button type="button" className="m-tap m-block m-destructive" onClick={() => onChoose('overwrite')}>
        Overwrite
      </button>
    </ChoiceSheet>
  );
}
