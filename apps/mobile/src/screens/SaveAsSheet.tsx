/**
 * <SaveAsSheet/>: the Save as name prompt for a document saved into an opened local folder (the file layer's
 * LocalSaveHooks.promptName). A "File name" box prefilled with the suggestion, the live reason a name cannot be used
 * (fileNameProblem), Cancel and Save; Save creates the file through request.create and, when the folder already has
 * a file of that name, says so here ("<name> already exists in <folder>.") and stays open for another name (nothing is
 * overwritten). Any other failure closes the sheet and goes to the error banner through onFail.
 */
import { useEffect, useRef, useState } from 'react';
import type { SavedDocument } from '@gonq/editor/platform/files';
import { LocalFileError } from '@gonq/editor/platform/local';
import { BottomSheet } from '../shell/BottomSheet';
import { fileNameProblem, withMarkdownExtension } from '../shell/localFiles';

export interface SaveAsRequest {
  suggested: string;
  folderName: string;
  create(name: string): Promise<SavedDocument>;
}

export function SaveAsSheet({ request, onDone, onFail }: { request: SaveAsRequest; onDone(saved: SavedDocument | null): void; onFail(e: unknown): void }) {
  const [name, setName] = useState(request.suggested);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const problem = fileNameProblem(name);
  const submit = async () => {
    if (problem !== null || busy) return;
    setBusy(true);
    try {
      onDone(await request.create(name));
    } catch (e) {
      if (e instanceof LocalFileError && e.kind === 'exists') {
        setTaken(`${withMarkdownExtension(name.trim())} already exists in ${request.folderName}.`);
        setBusy(false);
      } else onFail(e);
    }
  };
  return (
    <BottomSheet open title="Save as" onClose={() => onDone(null)}>
      <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--muted-foreground)' }}>Saved in {request.folderName}</p>
      <label style={{ display: 'block', marginTop: 'var(--space-2)' }}>
        File name
        <input
          ref={input}
          type="text"
          className="m-tap m-field"
          style={{ margin: 'var(--space-1) 0 0', width: '100%' }}
          value={name}
          aria-invalid={problem !== null}
          onChange={(e) => {
            setName(e.target.value);
            setTaken(null);
          }}
        />
      </label>
      {(taken ?? problem) !== null && (
        <p role="alert" style={{ margin: 'var(--space-2) 0 0', color: 'var(--destructive)' }}>
          {taken ?? problem}
        </p>
      )}
      <button type="button" className="m-tap m-tap-primary m-block" disabled={problem !== null || busy || taken !== null} onClick={() => void submit()}>
        Save
      </button>
      <button type="button" className="m-tap m-outline m-block" onClick={() => onDone(null)}>
        Cancel
      </button>
    </BottomSheet>
  );
}
