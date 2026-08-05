import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { filterOptions, resolveSelection } from './searchSelectUtils';

export type SearchSelectOption = { value: string; label: string };

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  disabled,
  tabIndex,
  id: idProp,
  inputRef: inputRefProp,
  nextFocusRef,
  onSelected,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  tabIndex?: number;
  id?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  nextFocusRef?: RefObject<HTMLElement | null>;
  onSelected?: (value: string) => void;
}) {
  const generatedId = useId();
  const inputId = idProp ?? `search-select-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const internalInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [highlightMovedByKeyboard, setHighlightMovedByKeyboard] = useState(false);

  const safeOptions = options ?? [];
  const selected = safeOptions.find((o) => o.value === value);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(
    () => filterOptions(safeOptions, debouncedQuery),
    [safeOptions, debouncedQuery],
  );

  const filteredKey = (filtered ?? []).map((o) => o.value).join('\0');

  useEffect(() => {
    setHighlightIndex(0);
    setHighlightMovedByKeyboard(false);
  }, [filteredKey, open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open, filteredKey]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const root = internalInputRef.current?.closest('[data-search-select-root]');
      if (root && !root.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function assignInputRef(el: HTMLInputElement | null) {
    internalInputRef.current = el;
    if (inputRefProp) {
      (inputRefProp as { current: HTMLInputElement | null }).current = el;
    }
  }

  function commitSelection(option: SearchSelectOption, advanceFocus: boolean) {
    onChange(option.value);
    onSelected?.(option.value);
    setOpen(false);
    setQuery('');
    if (advanceFocus) {
      requestAnimationFrame(() => {
        nextFocusRef?.current?.focus();
      });
    }
  }

  function closeWithoutChange() {
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (filtered.length === 0) return;
      setHighlightMovedByKeyboard(true);
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (filtered.length === 0) return;
      setHighlightMovedByKeyboard(true);
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      closeWithoutChange();
      return;
    }

    if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const option = resolveSelection(filtered, highlightIndex, highlightMovedByKeyboard, 'enter');
      if (option) commitSelection(option, true);
      return;
    }

    if (e.key === 'Tab') {
      if (!open) return;
      const option = resolveSelection(filtered, highlightIndex, highlightMovedByKeyboard, 'tab');
      if (option) {
        e.preventDefault();
        onChange(option.value);
        onSelected?.(option.value);
        setOpen(false);
        setQuery('');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (nextFocusRef?.current) {
              nextFocusRef.current.focus();
            } else {
              internalInputRef.current?.form?.querySelector<HTMLElement>(
                `[tabindex="${(tabIndex ?? 0) + 1}"]`,
              )?.focus();
            }
          });
        });
      } else {
        closeWithoutChange();
      }
    }
  }

  const activeOptionId =
    open && filtered.length > 0 ? `${listboxId}-option-${highlightIndex}` : undefined;

  return (
    <div data-search-select-root className={`relative ${open ? 'z-[200]' : 'z-0'}`}>
      <input
        ref={assignInputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        tabIndex={tabIndex}
        value={open ? query : selected?.label ?? ''}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="app-input disabled:cursor-not-allowed disabled:bg-surface1"
      />
      {open ? (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="app-combobox-dropdown absolute left-0 top-full z-[201] mt-1 max-h-60 w-full overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <p className="bg-white px-3 py-2 text-sm text-textMuted" role="status">
              No matches
            </p>
          ) : (
            filtered.map((o, index) => {
              const isHighlighted = index === highlightIndex;
              const isSelected = o.value === value;
              return (
                <div
                  key={o.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isHighlighted ? 'true' : 'false'}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => commitSelection(o, Boolean(nextFocusRef))}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    isHighlighted || isSelected
                      ? 'bg-bgAccent font-medium text-textAccent'
                      : 'bg-white text-textPrimary hover:bg-bgAccent'
                  }`}
                >
                  {o.label}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
