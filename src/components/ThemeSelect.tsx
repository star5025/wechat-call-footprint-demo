import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface ThemeSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ThemeSelectProps {
  value: string;
  options: ThemeSelectOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}

export function ThemeSelect({ value, options, onChange, label, disabled = false }: ThemeSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>(".theme-select-trigger")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [open, selectedIndex]);

  const nextEnabledIndex = (start: number, delta: number) => {
    let index = start;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + delta + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return start;
  };

  const focusOption = (index: number) => {
    setActiveIndex(index);
    optionRefs.current[index]?.focus();
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(".theme-select-trigger")?.focus());
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(nextEnabledIndex(index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(nextEnabledIndex(index, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = options.findIndex((option) => !option.disabled);
      if (first >= 0) focusOption(first);
    } else if (event.key === "End") {
      event.preventDefault();
      let last = options.length - 1;
      while (last >= 0 && options[last].disabled) last -= 1;
      if (last >= 0) focusOption(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(index);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`theme-select${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="theme-select-trigger"
        disabled={disabled}
        aria-label={`${label}：${selected?.label ?? "未选择"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => !disabled && setOpen((current) => !current)}
      >
        <span>{selected?.label ?? "请选择"}</span><b className="theme-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="theme-select-menu" id={listboxId} role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              disabled={option.disabled}
              aria-selected={option.value === value}
              tabIndex={index === activeIndex ? 0 : -1}
              className={option.value === value ? "selected" : ""}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              <span>{option.label}</span>{option.value === value && <b aria-hidden="true">✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
