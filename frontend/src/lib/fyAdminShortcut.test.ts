// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clearFyAdminShortcutKeys,
  isFyAdminShortcutActive,
  trackFyAdminShortcutKey,
  untrackFyAdminShortcutKey,
} from './fyAdminShortcut';

function keyEvent(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  return new KeyboardEvent(type, { bubbles: true, ...init });
}

describe('fyAdminShortcut', () => {
  it('does not track plain letter keys without all modifiers', () => {
    const keys = new Set<string>();
    trackFyAdminShortcutKey(keys, keyEvent('keydown', { key: 'a', code: 'KeyA' }));
    expect(keys.has('a')).toBe(false);
  });

  it('tracks a and s only when modifiers are held', () => {
    const keys = new Set<string>();
    const mods = { ctrlKey: true, altKey: true, shiftKey: true } as const;

    trackFyAdminShortcutKey(keys, keyEvent('keydown', { ...mods, key: 'a', code: 'KeyA' }));
    trackFyAdminShortcutKey(keys, keyEvent('keydown', { ...mods, key: 's', code: 'KeyS' }));

    expect(isFyAdminShortcutActive(keyEvent('keydown', { ...mods, key: 's', code: 'KeyS' }), keys)).toBe(true);
  });

  it('clears stale keys when modifiers are released', () => {
    const keys = new Set<string>(['a', 's']);
    untrackFyAdminShortcutKey(keys, keyEvent('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false, altKey: false, shiftKey: false }));
    expect(keys.size).toBe(0);
  });

  it('does not false-positive from typing admin in a password field', () => {
    const keys = new Set<string>();
    trackFyAdminShortcutKey(keys, keyEvent('keydown', { key: 'a', code: 'KeyA' }));
    trackFyAdminShortcutKey(keys, keyEvent('keydown', { key: 'd', code: 'KeyD' }));
    trackFyAdminShortcutKey(keys, keyEvent('keydown', { key: 'm', code: 'KeyM' }));
    trackFyAdminShortcutKey(keys, keyEvent('keydown', { key: 's', code: 'KeyS' }));

    expect(
      isFyAdminShortcutActive(
        keyEvent('keydown', { key: 's', code: 'KeyS' }),
        keys,
      ),
    ).toBe(false);
  });

  it('supports manual clear on blur', () => {
    const keys = new Set<string>(['a', 's']);
    clearFyAdminShortcutKeys(keys);
    expect(keys.size).toBe(0);
  });
});
