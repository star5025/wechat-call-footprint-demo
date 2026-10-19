import { useEffect, useRef, useState } from "react";
import { ContactAvatar } from "@/components/ContactAvatar";
import { useApp } from "@/state/AppContext";

export function ContactSwitcher() {
  const { dataset, activeContactId, selectContact } = useApp();
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
  return (
    <div className="contact-switch-wrap" ref={root}>
      <button className="contact-switch" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ContactAvatar key={contact.id} contact={contact} className="mini-avatar contact-switch-enter" />
        <span key={`name-${contact.id}`} className="contact-switch-copy contact-switch-enter">
          <small>正在查看</small>
          <strong>{contact.displayName}</strong>
        </span>
        <b>⌄</b>
      </button>
      {open && (
        <div className="contact-menu-react">
          {dataset.contacts.map((item) => (
            <button key={item.id} onClick={() => { selectContact(item.id); setOpen(false); }}>
              <ContactAvatar contact={item} className="mini-avatar" />
              <span>
                <strong>{item.displayName}</strong>
                <small>{item.needsReview ? "待确认" : "已识别"}</small>
              </span>
              {item.id === activeContactId && <b>✅</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
