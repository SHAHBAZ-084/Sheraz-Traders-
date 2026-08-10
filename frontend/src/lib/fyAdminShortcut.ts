/** Hidden FY admin gate shortcut: Ctrl+Alt+Shift+A then S (both with modifiers held). */

export function trackFyAdminShortcutKey(keys: Set<string>, event: KeyboardEvent) {
  if (!event.ctrlKey || !event.altKey || !event.shiftKey) {
    keys.clear();
    return;
  }

  const code = event.code.toLowerCase();
  if (code === 'keya') keys.add('a');
  if (code === 'keys') keys.add('s');
}

export function untrackFyAdminShortcutKey(keys: Set<string>, event: KeyboardEvent) {
  const code = event.code.toLowerCase();
  if (code === 'keya') keys.delete('a');
  if (code === 'keys') keys.delete('s');
  if (!event.ctrlKey && !event.altKey && !event.shiftKey) {
    keys.clear();
  }
}

export function isFyAdminShortcutActive(event: KeyboardEvent, keys: Set<string>) {
  return (
    event.ctrlKey &&
    event.altKey &&
    event.shiftKey &&
    keys.has('a') &&
    keys.has('s')
  );
}

export function clearFyAdminShortcutKeys(keys: Set<string>) {
  keys.clear();
}
