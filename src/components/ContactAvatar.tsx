import { useEffect, useState } from "react";
import type { Contact } from "@contracts/models";

interface AvatarProps {
  avatarRef?: string | null;
  label: string;
  className?: string;
}

export function Avatar({ avatarRef, label, className = "" }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatarRef]);

  const showImage = Boolean(avatarRef) && !failed;
  return (
    <span className={`contact-avatar ${className}`.trim()} aria-hidden="true">
      {showImage ? (
        <img src={avatarRef!} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{label.slice(0, 1) || "?"}</span>
      )}
    </span>
  );
}

interface ContactAvatarProps {
  contact: Contact;
  className?: string;
}

export function ContactAvatar({ contact, className = "" }: ContactAvatarProps) {
  return (
    <Avatar
      avatarRef={contact.avatarRef}
      label={contact.displayName}
      className={className}
    />
  );
}
