import { describe, expect, it } from 'vitest';
import { getFocusableElements } from '../hooks/useFocusTrap';

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
