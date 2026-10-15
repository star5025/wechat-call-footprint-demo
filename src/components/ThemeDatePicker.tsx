import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

const pad = (value: number) => String(value).padStart(2, "0");
const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
const today = () => toIsoDate(new Date());
const monthValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

interface ThemeDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
  allowClear?: boolean;
}

export function ThemeDatePicker({ value, onChange, label, min, max, allowClear = false }: ThemeDatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => value ? value.slice(0, 7) : monthValue(new Date()));
  const [focusedDate, setFocusedDate] = useState(value || today());

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (value) {
      setViewMonth(value.slice(0, 7));
      setFocusedDate(value);
    }
  }, [value]);

  const [year, month] = viewMonth.split("-").map(Number);
  const days = useMemo(() => {
    const first = new Date(year, month - 1, 1, 12);
    const mondayOffset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(year, month - 1, 1 - mondayOffset + index, 12);
      const iso = toIsoDate(date);
      return {
        iso,
        day: date.getDate(),
        currentMonth: date.getMonth() === month - 1,
        disabled: Boolean((min && iso < min) || (max && iso > max))
      };
    });
  }, [max, min, month, year]);

  const moveMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1, 12);
    const nextMonth = monthValue(next);
    if (min && `${nextMonth}-31` < min) return;
    if (max && `${nextMonth}-01` > max) return;
    setViewMonth(nextMonth);
  };

  const focusDay = (iso: string) => {
    setFocusedDate(iso);
    setViewMonth(iso.slice(0, 7));
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${iso}"]`)?.focus();
    });
  };

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, iso: string) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = parseDate(iso);
    next.setDate(next.getDate() + offsets[event.key]);
    const nextIso = toIsoDate(next);
    if ((min && nextIso < min) || (max && nextIso > max)) return;
    focusDay(nextIso);
  };

  const openCalendar = () => {
    const initial = value || today();
    setViewMonth(initial.slice(0, 7));
    setFocusedDate(initial);
    setOpen((current) => !current);
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${initial}"]`)?.focus();
    });
  };

  const selectDate = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div className="theme-date-picker" ref={rootRef}>
      <button type="button" className="theme-date-trigger" aria-label={`${label}：${value || "未选择"}`} aria-haspopup="dialog" aria-expanded={open} onClick={openCalendar}>
        <span>{value ? value.replaceAll("-", "/") : "选择日期"}</span><b aria-hidden="true">📅</b>
      </button>
      {open && (
        <section className="theme-calendar" role="dialog" aria-label={`${label}日历`}>
          <header><button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button><strong>{year} 年 {month} 月</strong><button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>›</button></header>
          <div className="theme-calendar-week" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div className="theme-calendar-grid" role="grid">
            {days.map((item) => <button type="button" role="gridcell" data-date={item.iso} key={item.iso} disabled={item.disabled} tabIndex={item.iso === focusedDate ? 0 : -1} className={`${item.currentMonth ? "" : "outside"}${item.iso === value ? " selected" : ""}${item.iso === today() ? " today" : ""}`} aria-label={item.iso} aria-selected={item.iso === value} onKeyDown={(event) => handleDayKeyDown(event, item.iso)} onClick={() => selectDate(item.iso)}>{item.day}</button>)}
          </div>
          <footer>{allowClear && <button type="button" onClick={() => { onChange(""); setOpen(false); }}>清除</button>}<button type="button" onClick={() => { const current = today(); if ((!min || current >= min) && (!max || current <= max)) selectDate(current); }}>今天</button></footer>
        </section>
      )}
    </div>
  );
}

interface ThemeMonthPickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
}

export function ThemeMonthPicker({ value, onChange, label, min, max }: ThemeMonthPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const minYear = Number(min?.slice(0, 4)) || 1900;
  const maxYear = Number(max?.slice(0, 4)) || 2100;
  return (
    <div className="theme-date-picker" ref={rootRef}>
      <button type="button" className="theme-date-trigger" aria-label={`${label}：${value}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setViewYear(Number(value.slice(0, 4)) || new Date().getFullYear()); setOpen((current) => !current); }}><span>{Number(value.slice(0, 4))} 年 {Number(value.slice(5))} 月</span><b aria-hidden="true">📅</b></button>
      {open && <section className="theme-calendar theme-month-calendar" role="dialog" aria-label={`${label}选择`}><header><button type="button" aria-label="上一年" disabled={viewYear <= minYear} onClick={() => setViewYear((year) => year - 1)}>‹</button><strong>{viewYear} 年</strong><button type="button" aria-label="下一年" disabled={viewYear >= maxYear} onClick={() => setViewYear((year) => year + 1)}>›</button></header><div className="theme-month-grid">{Array.from({ length: 12 }, (_, index) => { const option = `${viewYear}-${pad(index + 1)}`; const disabled = Boolean((min && option < min) || (max && option > max)); return <button type="button" key={option} disabled={disabled} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{index + 1} 月</button>; })}</div><footer><button type="button" onClick={() => { const current = monthValue(new Date()); if ((!min || current >= min) && (!max || current <= max)) { onChange(current); setOpen(false); } }}>本月</button></footer></section>}
    </div>
  );
}
