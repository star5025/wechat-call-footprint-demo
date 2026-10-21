import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ContactAvatar";
import { ThemeSelect } from "@/components/ThemeSelect";
import { useApp } from "@/state/AppContext";
import { isPagesDemo } from "@/runtime";

export function AccountManager() {
  const { accountsOpen } = useApp();
  return accountsOpen ? <AccountManagerDialog /> : null;
}

function AccountManagerDialog() {
  const { collection, accountScope, setAccountsOpen, removeAccount, linkContacts, unlinkContacts,
    appInfo, wechatScanning, macSetupOpen, dataLoading, scanWechat, chooseImport, notify, settings } = useApp();
  const [adding, setAdding] = useState(false);
  const [associating, setAssociating] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const busy = pending || wechatScanning || macSetupOpen || Boolean(dataLoading);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(() => setAccountsOpen(false));
  closeRef.current = () => setAccountsOpen(false);
  const datasets = collection.datasets;
  const contacts = datasets.flatMap(({ account, contacts }) => contacts.map((contact) => ({
    value: JSON.stringify([account.id, contact.id]),
    label: `${account.displayName || "微信用户"} · ${contact.displayName}`,
    accountId: account.id,
    contactId: contact.id
  })));
  const firstContact = contacts.find((contact) => contact.value === first);
  const secondContact = contacts.find((contact) => contact.value === second);
  const canLink = firstContact && secondContact && firstContact.accountId !== secondContact.accountId;
  const removing = datasets.find(({ account }) => account.id === removeId);
  const scopeLabel = accountScope === null ? "全部账号" : datasets.find(({ account }) => account.id === accountScope)?.account.displayName || "微信用户";

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        if (dialog.querySelector('.theme-select-trigger[aria-expanded="true"]')) return;
        event.stopImmediatePropagation();
        if (!busyRef.current && !pendingRef.current) closeRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0);
      const firstElement = focusable[0];
      const lastElement = focusable.at(-1);
      if (!firstElement) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === firstElement || !dialog.contains(document.activeElement) || document.activeElement === dialog)) {
        event.preventDefault(); lastElement?.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || !dialog.contains(document.activeElement))) {
        event.preventDefault(); firstElement.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      mounted.current = false;
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected && !previousFocus.closest('[aria-hidden="true"]')) previousFocus.focus();
      else document.querySelector<HTMLButtonElement>('.top-actions button[aria-label="打开设置"]')?.focus();
    };
  }, []);

  const run = async (operation: () => Promise<void>, success: string, after?: () => void) => {
    if (pendingRef.current || busyRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await operation();
      if (mounted.current) { after?.(); notify(success); }
    } catch {
      if (mounted.current) notify("操作未完成，请重试");
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const close = () => { if (!busyRef.current && !pendingRef.current) setAccountsOpen(false); };
  const startSource = (source: "scan" | "import") => {
    if (busyRef.current || pendingRef.current) return;
    setAccountsOpen(false);
    void (source === "scan" ? scanWechat() : chooseImport()).catch(() => notify("未能打开，请重试"));
  };

  return (
    <div className={`account-manager-backdrop${settings.reducedMotion ? " account-manager-reduced-motion" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="account-manager" role="dialog" aria-modal="true" aria-labelledby="account-manager-title" aria-busy={pending} tabIndex={-1} ref={dialogRef}>
        <header className="account-manager-header">
          <div><h2 id="account-manager-title">账号管理</h2><p>当前范围：{scopeLabel}</p></div>
          <button type="button" className="account-manager-close" aria-label="关闭账号管理" disabled={busy} onClick={close}>×</button>
        </header>
        <div className="account-manager-list">
          {datasets.length === 0 && <p className="account-manager-hint">暂无账号</p>}
          {datasets.map(({ account, contacts, events }) => (
            <div className="account-manager-row" key={account.id}>
              <Avatar avatarRef={account.avatarRef} label={account.displayName || "微信用户"} className="mini-avatar" />
              <div className="account-manager-copy"><strong>{account.displayName || "微信用户"}</strong><small>{contacts.length} 位联系人 · {events.length} 条通话</small></div>
              <button type="button" className="account-manager-remove" disabled={busy || removeId !== null} onClick={() => setRemoveId(account.id)} aria-label={`移除账号 ${account.displayName}`}>移除</button>
            </div>
          ))}
        </div>
        {removing && (
          <div className="account-manager-confirm" role="group" aria-label="确认移除账号">
            <strong>移除「{removing.account.displayName || "微信用户"}」？</strong>
            <p>仅移除本应用保存的该账号记录与联系人关联，不会删除微信中的数据，也不会删除微信密钥。</p>
            <div className="account-manager-actions">
              <button type="button" className="secondary-action" disabled={busy} onClick={() => setRemoveId(null)}>取消</button>
              <button type="button" className="danger-action" disabled={busy} onClick={() => void run(() => removeAccount(removing.account.id), "账号已移除", () => setRemoveId(null))}>{pending ? "处理中…" : "确认移除"}</button>
            </div>
          </div>
        )}
        {!isPagesDemo && <div className="account-manager-add">
          <button type="button" className="secondary-action" disabled={busy || removeId !== null} aria-expanded={adding} aria-controls="account-manager-sources" onClick={() => setAdding(!adding)}>添加账号</button>
          <p className="account-manager-hint">同一账号再次读取会更新，不重复累计</p>
          {adding && <div id="account-manager-sources">
            <div className="account-manager-actions">
              <button type="button" className="primary-action" disabled={busy || removeId !== null || !appInfo?.isTauri} onClick={() => startSource("scan")}>读取微信</button>
              <button type="button" className="secondary-action" disabled={busy || removeId !== null} onClick={() => startSource("import")}>打开文件</button>
            </div>
            <p className="account-manager-hint">读取的账号会自动加入或更新。如需其他账号，请先在微信中切换；也可打开该账号的文件。</p>
          </div>}
        </div>}
        <div className="account-manager-links">
          <button type="button" className="account-manager-disclosure" disabled={busy || removeId !== null} aria-expanded={associating} aria-controls="account-manager-associations" onClick={() => setAssociating(!associating)}>联系人关联 <span aria-hidden="true">{associating ? "−" : "+"}</span></button>
          {associating && <div id="account-manager-associations">
            <p className="account-manager-hint">仅手动关联不同账号中属于同一人的联系人。</p>
            <div className="account-manager-link-form">
              <ThemeSelect label="第一位联系人" value={firstContact ? first : ""} options={[{ value: "", label: "选择联系人" }, ...contacts]} disabled={busy || removeId !== null} onChange={(value) => { setFirst(value); setSecond(""); }} />
              <ThemeSelect label="另一账号的联系人" value={secondContact ? second : ""} options={[{ value: "", label: "选择另一账号的联系人" }, ...contacts.filter((contact) => contact.accountId !== firstContact?.accountId)]} disabled={busy || removeId !== null || !firstContact} onChange={setSecond} />
              <button type="button" className="primary-action" disabled={busy || removeId !== null || !canLink} onClick={() => {
                if (!firstContact || !secondContact || !canLink) return;
                void run(() => linkContacts([firstContact, secondContact].map(({ accountId, contactId }) => ({ accountId, contactId }))), "联系人已关联", () => { setFirst(""); setSecond(""); });
              }}>关联</button>
            </div>
            <ul className="account-manager-link-list">
              {collection.links.map((group, index) => <li key={JSON.stringify(group.members)}>
                <span>{group.members.map((member) => {
                  const dataset = datasets.find(({ account }) => account.id === member.accountId);
                  const contact = dataset?.contacts.find((contact) => contact.id === member.contactId);
                  return `${dataset?.account.displayName || "微信用户"} · ${contact?.displayName || "联系人"}`;
                }).join(" ↔ ")}</span>
                <button type="button" disabled={busy || removeId !== null} aria-label={`撤销第 ${index + 1} 组联系人关联`} onClick={() => void run(() => unlinkContacts(index), "已撤销关联")}>撤销</button>
              </li>)}
            </ul>
            {!collection.links.length && <p className="account-manager-hint">暂无手动关联</p>}
          </div>}
        </div>
      </section>
    </div>
  );
}
