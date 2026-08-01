import { useEffect, useState, type RefObject } from 'react';

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

function hasOpenCombobox(container: HTMLElement): boolean {
  return Boolean(container.querySelector('[role="combobox"][aria-expanded="true"]'));
}

type UseFocusTrapOptions = {
  /** Focus target when Escape releases the trap (e.g. page title). */
  escapeFocusRef?: RefObject<HTMLElement | null>;
  /** Initial focus target; defaults to first focusable in container. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions = {},
) {
  const [trapped, setTrapped] = useState(true);

  useEffect(() => {
    if (!trapped || !containerRef.current) return;

    const container = containerRef.current;

    requestAnimationFrame(() => {
      if (options.initialFocusRef?.current) {
        options.initialFocusRef.current.focus();
        return;
      }
      getFocusableElements(container)[0]?.focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (!trapped) return;

      if (e.key === 'Escape') {
        if (hasOpenCombobox(container)) return;
        e.preventDefault();
        setTrapped(false);
        requestAnimationFrame(() => {
          options.escapeFocusRef?.current?.focus();
        });
        return;
      }

      if (e.key !== 'Tab') return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) return;

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || (active && !container.contains(active))) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [trapped, containerRef, options.escapeFocusRef, options.initialFocusRef]);

  return { trapped, releaseTrap: () => setTrapped(false) };
}
