import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isFocusableCandidate(el: HTMLElement, container: HTMLElement): boolean {
  if (!container.contains(el)) return false;
  if (el.getAttribute('role') === 'option') return false;
  if (el.closest('[role="listbox"]')) return false;
  if (el.tabIndex < 0) return false;
  if (el.hasAttribute('disabled')) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => isFocusableCandidate(el, container),
  );

  return nodes.sort((a, b) => {
    const order = (el: HTMLElement) => (el.tabIndex > 0 ? el.tabIndex : 1000);
    const diff = order(a) - order(b);
    if (diff !== 0) return diff;
    if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 1;
  });
}

function findFocusableIndex(active: HTMLElement | null, focusables: HTMLElement[]): number {
  if (!active) return -1;
  const directIndex = focusables.indexOf(active);
  if (directIndex !== -1) return directIndex;
  return focusables.findIndex((el) => el.contains(active));
}

function isModalActive(container: HTMLElement): boolean {
  const modal = document.querySelector<HTMLElement>('[role="dialog"], [aria-modal="true"]');
  if (!modal) return false;
  return !modal.contains(container) && modal !== container;
}

type UseFocusTrapOptions = {
  escapeFocusRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  disabled?: boolean;
};

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions = {},
) {
  const { initialFocusRef, disabled = false } = options;

  useEffect(() => {
    if (disabled || !containerRef.current) return;
    const container = containerRef.current;

    const timer = requestAnimationFrame(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else {
        const focusables = getFocusableElements(container);
        if (focusables.length > 0 && (!document.activeElement || !container.contains(document.activeElement))) {
          focusables[0].focus();
        }
      }
    });

    return () => cancelAnimationFrame(timer);
  }, [containerRef, initialFocusRef, disabled]);

  useEffect(() => {
    if (disabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (!containerRef.current) return;

      const container = containerRef.current;

      if (isModalActive(container)) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      const currentIndex = findFocusableIndex(active, focusables);

      if (e.shiftKey) {
        if (currentIndex <= 0) {
          e.preventDefault();
          last.focus();
        } else {
          e.preventDefault();
          focusables[currentIndex - 1].focus();
        }
      } else {
        if (currentIndex === -1 || currentIndex >= focusables.length - 1) {
          e.preventDefault();
          first.focus();
        } else {
          e.preventDefault();
          focusables[currentIndex + 1].focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [containerRef, disabled]);

  return { trapped: !disabled };
}
