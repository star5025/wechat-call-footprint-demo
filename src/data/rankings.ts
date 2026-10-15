import type { Contact } from "@contracts/models";
import type { AppDataset } from "@/domain";

export interface ContactDurationRank {
  rank: number;
  contact: Contact;
  totalDurationSeconds: number;
  connectedCount: number;
  attemptedCount: number;
  unknownDurationCount: number;
  lastCallAt: string | null;
}

export function rankContactsByDuration(dataset: AppDataset): ContactDurationRank[] {
  const contacts = new Map(dataset.contacts.map((contact) => [contact.id, contact]));
  const totals = new Map<string, Omit<ContactDurationRank, "rank" | "contact">>();

  for (const event of dataset.events) {
    if (event.excluded || !event.contactId || !contacts.has(event.contactId)) continue;
    const current = totals.get(event.contactId) ?? {
      totalDurationSeconds: 0,
      connectedCount: 0,
      attemptedCount: 0,
      unknownDurationCount: 0,
      lastCallAt: null
    };
    const duration = event.connectedDurationSeconds;
    current.attemptedCount += 1;
    if (duration === null) {
      current.unknownDurationCount += 1;
    } else if (duration > 0) {
      current.totalDurationSeconds += duration;
      current.connectedCount += 1;
    }
    if (event.startedAt && (!current.lastCallAt || event.startedAt > current.lastCallAt)) {
      current.lastCallAt = event.startedAt;
    }
    totals.set(event.contactId, current);
  }

  const timeValue = (value: string | null) => value ? Date.parse(value) || 0 : 0;

  return [...totals.entries()]
    .filter(([, total]) => total.connectedCount > 0)
    .map(([contactId, total]) => ({ contact: contacts.get(contactId)!, ...total }))
    .sort((left, right) =>
      right.totalDurationSeconds - left.totalDurationSeconds
      || right.connectedCount - left.connectedCount
      || timeValue(right.lastCallAt) - timeValue(left.lastCallAt)
      || left.contact.displayName.localeCompare(right.contact.displayName, "zh-CN")
      || left.contact.id.localeCompare(right.contact.id)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
