import * as DialogPrimitive from '@radix-ui/react-dialog';
import logo from '../assets/gonq-logo-FULL.svg';
import { REPO_URL, openExternal, opensExternallyNatively } from '../platform/external';

export const APP_VERSION: string = __APP_VERSION__;

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const native = opensExternallyNatively();
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // The menu item that opened this is gone by now; hand focus back to the Help menu.
          onCloseAutoFocus={(e) => {
            const help = document.querySelector<HTMLElement>('[data-help-menu]');
            if (help) {
              e.preventDefault();
              help.focus();
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[420px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col items-center overflow-auto rounded-container border border-border bg-surface p-6 text-center [box-shadow:var(--shadow-dialog)]"
        >
          <img src={logo} alt="Gonq logo" className="mb-3 h-56 w-56 max-w-full object-contain" />
          <DialogPrimitive.Title className="m-0 text-[20px] font-semibold">Gonq</DialogPrimitive.Title>
          <p className="m-0 mb-3 text-[13px] text-muted-foreground">Version {APP_VERSION}</p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            onClick={
              native
                ? (e) => {
                    e.preventDefault();
                    void openExternal(REPO_URL).catch(() => {});
                  }
                : undefined
            }
            className="mb-5 break-all text-[13px] text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {REPO_URL}
          </a>
          <DialogPrimitive.Close className={`${button} border-primary bg-primary text-primary-foreground`}>Close</DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
