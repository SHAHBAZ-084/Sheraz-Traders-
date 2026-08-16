// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createElement, createRef, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFocusableElements, useFocusTrap } from '../hooks/useFocusTrap';

describe('getFocusableElements', () => {
  it('excludes tabindex -1 and listbox options', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <input tabindex="1" />
      <input tabindex="-1" readonly />
      <div role="listbox"><div role="option">x</div></div>
      <button tabindex="2">Save</button>
    `;
    document.body.appendChild(container);
    const focusables = getFocusableElements(container);
    expect(focusables).toHaveLength(2);
    expect(focusables[0]?.tabIndex).toBe(1);
    expect(focusables[1]?.tabIndex).toBe(2);
    container.remove();
  });
});

function TrapHarness({ containTab }: { containTab?: boolean }) {
  const ref = createRef<HTMLDivElement>();
  useFocusTrap(ref, { containTab: containTab ?? false });

  return createElement(
    'div',
    null,
    createElement('a', { href: '/outside', id: 'outside-link' }, 'Outside'),
    createElement(
      'div',
      {
        ref,
        'data-focus-trap': 'form',
        ...(containTab ? {} : { role: 'dialog', 'aria-modal': 'true' }),
      },
      createElement('input', { id: 'first', defaultValue: '' }),
      createElement('input', { id: 'second', defaultValue: '' }),
      createElement('button', { type: 'button', id: 'last' }, 'Close'),
    ),
  );
}

describe('useFocusTrap containTab', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('wraps Tab from last field to first inside a page form', async () => {
    await act(async () => {
      root.render(createElement(TrapHarness, { containTab: true }));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const first = document.getElementById('first') as HTMLInputElement;
    const last = document.getElementById('last') as HTMLButtonElement;
    last.focus();
    expect(document.activeElement).toBe(last);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from first field to last', async () => {
    await act(async () => {
      root.render(createElement(TrapHarness, { containTab: true }));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const first = document.getElementById('first') as HTMLInputElement;
    const last = document.getElementById('last') as HTMLButtonElement;
    first.focus();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(last);
  });

  it('pulls Tab back into the form when focus is on background chrome', async () => {
    await act(async () => {
      root.render(createElement(TrapHarness, { containTab: true }));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const outside = document.getElementById('outside-link') as HTMLAnchorElement;
    const first = document.getElementById('first') as HTMLInputElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  });

  it('does not steal focus when a field inside is already focused', async () => {
    await act(async () => {
      root.render(createElement(TrapHarness, { containTab: true }));
    });

    const second = document.getElementById('second') as HTMLInputElement;
    second.focus();
    expect(document.activeElement).toBe(second);

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(document.activeElement).toBe(second);
  });
});
