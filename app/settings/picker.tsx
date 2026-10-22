'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchOptions, type PickerOption } from './picker-logic';

export type { PickerOption };

// A searchable dropdown styled like the other fields, for long lists such as the AI catalog. The
// value is submitted through a hidden input named `name`. With `allowCustom`, whatever the owner
// types can be used as the value too, e.g. a model the catalog doesn't know yet.
export function Picker({
  name,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  allowCustom = false,
  disabled = false,
  className = '',
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => matchOptions(options, query, allowCustom), [options, query, allowCustom]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function choose(option: PickerOption) {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setActive(0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full items-center gap-2 rounded border border-pp-border bg-pp-surface px-3 text-left text-sm text-pp-ink focus:border-pp-blue focus:outline-none disabled:bg-pp-canvas disabled:text-pp-muted"
      >
        {selected?.icon && <Logo src={selected.icon} />}
        <span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-pp-muted'}`}>{selected?.label ?? (value || placeholder)}</span>
        {selected?.detail && <span className="shrink-0 truncate text-xs text-pp-muted">{selected.detail}</span>}
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 fill-none stroke-pp-muted" strokeWidth={2} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-pp-border bg-pp-surface shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search…"
            aria-controls={listId}
            className="h-10 w-full border-b border-pp-border px-3 text-sm focus:outline-none"
          />
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-pp-muted">No matches</li>}
            {shown.map((option, index) => (
              <li key={`${option.group ?? ''}/${option.value}`}>
                {option.group && option.group !== shown[index - 1]?.group && (
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-pp-muted">{option.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${index === active ? 'bg-pp-highlight' : ''} ${option.value === value ? 'font-semibold text-pp-blue' : 'text-pp-ink'}`}
                >
                  {option.icon && <Logo src={option.icon} />}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.detail && <span className="shrink-0 text-xs text-pp-muted">{option.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Provider logos come from models.dev; a missing one simply disappears.
function Logo({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-4 shrink-0" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
  );
}
