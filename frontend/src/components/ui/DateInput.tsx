import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { displayDateToIso, isoToDisplayDate, parseDateValue } from '../../lib/format';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function clampIso(iso: string, min?: string | number, max?: string | number): string {
  if (!iso) return iso;
  const minS = min != null && min !== '' ? String(min) : '';
  const maxS = max != null && max !== '' ? String(max) : '';
  if (minS && iso < minS) return minS;
  if (maxS && iso > maxS) return maxS;
  return iso;
}

function maskDisplayDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayIso(): string {
  return toIso(new Date());
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function buildMonthCells(year: number, month: number): Array<{ iso: string; day: number } | null> {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ iso: string; day: number } | null> = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push({ day, iso: toIso(new Date(year, month, day)) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isDisabled(iso: string, min?: string | number, max?: string | number): boolean {
  const minS = min != null && min !== '' ? String(min) : '';
  const maxS = max != null && max !== '' ? String(max) : '';
  if (minS && iso < minS) return true;
  if (maxS && iso > maxS) return true;
  return false;
}

/**
 * DD/MM/YYYY field plus a minimal calendar. Value sent to the app stays YYYY-MM-DD.
 */
export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function DateInput(props, ref) {
    const {
      value,
      onChange,
      onBlur,
      className = '',
      min,
      max,
      disabled,
      required,
      name,
      id,
      tabIndex,
      ...rest
    } = props;

    const iso = typeof value === 'string' ? value : '';
    const [text, setText] = useState(() => isoToDisplayDate(iso));
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = iso ? parseDateValue(iso) : new Date();
    const [viewYear, setViewYear] = useState(selected.getFullYear());
    const [viewMonth, setViewMonth] = useState(selected.getMonth());

    useEffect(() => {
      setText(isoToDisplayDate(iso));
    }, [iso]);

    useEffect(() => {
      if (!open) return;
      const basis = iso ? parseDateValue(iso) : new Date();
      setViewYear(basis.getFullYear());
      setViewMonth(basis.getMonth());
    }, [open, iso]);

    useEffect(() => {
      if (!open) return;
      function onDocMouseDown(e: MouseEvent) {
        if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
      }
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
      }
      document.addEventListener('mousedown', onDocMouseDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDocMouseDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);
    const today = todayIso();

    function emit(nextIso: string) {
      if (!onChange) return;
      const event = {
        target: { value: nextIso, name: name ?? '' },
        currentTarget: { value: nextIso, name: name ?? '' },
      } as ChangeEvent<HTMLInputElement>;
      onChange(event);
    }

    function commit(raw: string) {
      const parsed = displayDateToIso(raw);
      if (parsed == null) {
        setText(isoToDisplayDate(iso));
        return;
      }
      if (!parsed) {
        setText('');
        if (iso) emit('');
        return;
      }
      const next = clampIso(parsed, min, max);
      setText(isoToDisplayDate(next));
      if (next !== iso) emit(next);
    }

    function pick(nextIso: string) {
      if (isDisabled(nextIso, min, max)) return;
      const next = clampIso(nextIso, min, max);
      setText(isoToDisplayDate(next));
      if (next !== iso) emit(next);
      setOpen(false);
    }

    function shiftMonth(delta: number) {
      const next = new Date(viewYear, viewMonth + delta, 1);
      setViewYear(next.getFullYear());
      setViewMonth(next.getMonth());
    }

    return (
      <div className="app-date-input" ref={rootRef} data-date-input-root>
        <input
          {...rest}
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          lang="en-GB"
          className={`app-input app-date-input__field ${className}`.trim()}
          value={text}
          disabled={disabled}
          required={required}
          tabIndex={tabIndex}
          maxLength={10}
          onChange={(e) => {
            const next = maskDisplayDate(e.target.value);
            setText(next);
            const parsed = displayDateToIso(next);
            if (parsed) emit(clampIso(parsed, min, max));
            else if (parsed === '') emit('');
          }}
          onBlur={(e) => {
            if (rootRef.current?.contains(e.relatedTarget as Node)) return;
            commit(text);
            onBlur?.(e);
          }}
        />
        <button
          type="button"
          className="app-date-input__toggle"
          disabled={disabled}
          tabIndex={-1}
          aria-label="Open calendar"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <Calendar className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
        {open && !disabled ? (
          <div className="app-date-picker" role="dialog" aria-label="Choose date">
            <div className="app-date-picker__nav">
              <button
                type="button"
                className="app-date-picker__nav-btn"
                aria-label="Previous month"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <span className="app-date-picker__month">{monthLabel(viewYear, viewMonth)}</span>
              <button
                type="button"
                className="app-date-picker__nav-btn"
                aria-label="Next month"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="app-date-picker__weekdays">
              {WEEKDAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="app-date-picker__days">
              {cells.map((cell, index) =>
                cell ? (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={isDisabled(cell.iso, min, max)}
                    className={`app-date-picker__day${cell.iso === iso ? ' is-selected' : ''}${
                      cell.iso === today ? ' is-today' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(cell.iso)}
                  >
                    {cell.day}
                  </button>
                ) : (
                  <span key={`empty-${index}`} className="app-date-picker__day is-empty" />
                ),
              )}
            </div>
            <button
              type="button"
              className="app-date-picker__today"
              disabled={isDisabled(today, min, max)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(today)}
            >
              Today
            </button>
          </div>
        ) : null}
      </div>
    );
  },
);
