import { useEffect, useRef, useState } from "react";
import { useApp } from "@/state/AppContext";

export function ContactSwitcher() {
  const { dataset, activeContactId, selectContact, settings } = useApp();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const contact = dataset.contacts.find((item) => item.id === activeContactId) ?? dataset.contacts[0];

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!contact) return null;
  const displayName = settings.privacyMode ? "重要的人" : contact.displayName;
  return (
    <div className="contact-switch-wrap" ref={root}>
      <button className="contact-switch" onClick={() => setOpen((value) => !value)}>
        <span className="mini-avatar">{settings.privacyMode ? "♡" : contact.displayName.slice(0, 1)}</span>
        <span><small>正在查看</small><strong>{displayName}</strong></span><b>⌄</b>
      </button>
      {open && (
        <div className="contact-menu-react">
          {dataset.contacts.map((item) => (
            <button key={item.id} onClick={() => { selectContact(item.id); setOpen(false); }}>
              <span className="mini-avatar">{settings.privacyMode ? "♡" : item.displayName.slice(0, 1)}</span>
              <span><strong>{settings.privacyMode ? "重要的人" : item.displayName}</strong><small>{item.needsReview ? "身份需要确认" : "已识别联系人"}</small></span>
              {item.id === activeContactId && <b>✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
