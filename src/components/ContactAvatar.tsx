import { useEffect, useState } from "react";
import type { Contact } from "@contracts/models";

interface AvatarProps {
  avatarRef?: string | null;
  label: string;
  privacyMode?: boolean;
  className?: string;
}

export function Avatar({ avatarRef, label, privacyMode = false, className = "" }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatarRef]);

  const showImage = !privacyMode && Boolean(avatarRef) && !failed;
  return (
    <span className={`contact-avatar ${className}`.trim()} aria-hidden="true">
      {showImage ? (
        <img src={avatarRef!} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{privacyMode ? "♡" : label.slice(0, 1) || "?"}</span>
      )}
    </span>
  );
}

interface ContactAvatarProps {
  contact: Contact;
  privacyMode?: boolean;
  className?: string;
}

export function ContactAvatar({ contact, privacyMode = false, className = "" }: ContactAvatarProps) {
  return (
    <Avatar
      avatarRef={contact.avatarRef}
      label={contact.displayName}
      privacyMode={privacyMode}
      className={className}
    />
  );
}
