import { useLayoutEffect, useRef } from 'react';

// Existing drawers and confirmations share one keyboard/focus policy.
const dialogs: HTMLElement[] = [];
let bodyOverflow = '';
const focusableSelector = 'button, a[href], input, select, textarea, summary, [tabindex]';

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element =>
    element.tabIndex >= 0
    && !element.matches(':disabled')
    && !element.closest('[hidden], [inert]')
    && getComputedStyle(element).visibility !== 'hidden'
    && element.getClientRects().length > 0,
  );
}

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(onEscape: () => void, enabled = true) {
  const dialogRef = useRef<T>(null);
  const escapeRef = useRef(onEscape);
  useLayoutEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!enabled || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogs.length === 0) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogs.push(dialog);
    const isTop = () => dialogs[dialogs.length - 1] === dialog;
    const focusInitial = () => {
      const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]:not(:disabled)');
      (initial ?? focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
    };
    focusInitial();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusableElements(dialog);
        const first = elements[0];
        const last = elements[elements.length - 1];
        const active = document.activeElement;
        if (!first || !dialog.contains(active) || active === dialog
          || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) focusInitial();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      dialogs.splice(dialogs.indexOf(dialog), 1);
      if (dialogs.length === 0) document.body.style.overflow = bodyOverflow;
      // Wait until nested dialogs have also unmounted before restoring focus.
      queueMicrotask(() => {
        const top = dialogs[dialogs.length - 1];
        const target = opener?.isConnected && opener.getClientRects().length > 0
          ? opener
          : opener?.dataset.dialogOpener
            ? focusableElements(document.body).find(element => element.dataset.dialogOpener === opener.dataset.dialogOpener)
            : null;
        if (target?.isConnected && (!top || top.contains(target))) target.focus({ preventScroll: true });
      });
    };
  }, [enabled]);

  return dialogRef;
}
