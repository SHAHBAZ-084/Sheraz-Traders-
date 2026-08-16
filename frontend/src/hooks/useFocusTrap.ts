import { useEffect, useRef, type RefObject } from 'react';

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

function isModalContainer(container: HTMLElement): boolean {
  return container.getAttribute('role') === 'dialog' || container.getAttribute('aria-modal') === 'true';
}

type UseFocusTrapOptions = {
  escapeFocusRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  disabled?: boolean;
  /**
   * When true, trap Tab without requiring role="dialog" (full-page invoice/voucher forms).
   * Also redirects Tab back into the region if focus somehow leaves (e.g. top nav).
   */
  containTab?: boolean;
};

function isTrapContainer(container: HTMLElement, containTab: boolean): boolean {
  return containTab || isModalContainer(container);
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions = {},
) {
  const { initialFocusRef, disabled = false, containTab = false } = options;
  const didInitialFocusRef = useRef(false);

  useEffect(() => {
    if (disabled) {
      didInitialFocusRef.current = false;
      return;
    }
    if (!containerRef.current || didInitialFocusRef.current) return;

    const container = containerRef.current;
    if (!isTrapContainer(container, containTab)) return;

    const timer = requestAnimationFrame(() => {
      const liveContainer = containerRef.current;
      if (!liveContainer || !liveContainer.isConnected || didInitialFocusRef.current) return;

      // Never yank focus if the user already clicked/focused a field inside the trap.
      const active = document.activeElement as HTMLElement | null;
      if (active && liveContainer.contains(active) && isFocusableCandidate(active, liveContainer)) {
        didInitialFocusRef.current = true;
        return;
      }

      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else {
        const focusables = getFocusableElements(liveContainer);
        focusables[0]?.focus();
      }
      didInitialFocusRef.current = true;
    });

    return () => cancelAnimationFrame(timer);
  }, [containerRef, initialFocusRef, disabled, containTab]);

  useEffect(() => {
    if (disabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container || !container.isConnected || !isTrapContainer(container, containTab)) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = Boolean(active && container.contains(active));

      // Focus left the form (top nav, etc.) — pull Tab/Shift+Tab back inside.
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      const currentIndex = findFocusableIndex(active, focusables);

      if (e.shiftKey) {
        if (currentIndex <= 0) {
          e.preventDefault();
          last.focus();
        }
      } else if (currentIndex === -1 || currentIndex >= focusables.length - 1) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [containerRef, disabled, containTab]);

  return { trapped: !disabled };
}
