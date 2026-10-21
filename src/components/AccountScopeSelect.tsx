import { ThemeSelect } from "@/components/ThemeSelect";
import { useApp } from "@/state/AppContext";

export function AccountScopeSelect() {
  const { collection, accountScope, setAccountScope, wechatScanning, dataLoading, macSetupOpen } = useApp();
  return (
    <div className="account-scope-select">
      <ThemeSelect
        label="账号范围"
        value={JSON.stringify(accountScope)}
        options={[
          { value: "null", label: "全部账号" },
          ...collection.datasets.map(({ account }) => ({ value: JSON.stringify(account.id), label: account.displayName || "微信用户" }))
        ]}
        onChange={(value) => setAccountScope(JSON.parse(value) as string | null)}
        disabled={wechatScanning || Boolean(dataLoading) || macSetupOpen}
      />
    </div>
  );
}
