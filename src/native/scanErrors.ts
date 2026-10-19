const MACOS_SCAN_MESSAGES: Record<string, string> = {
  MACOS_APP_NOT_FOUND: "未找到微信",
  MACOS_VERSION_UNSUPPORTED: "微信版本不支持",
  MACOS_PERMISSION_DENIED: "请检查访问权限",
  MACOS_DATA_NOT_FOUND: "未找到微信记录",
  MACOS_MANIFEST_REQUIRED: "请先初始化密钥",
  MACOS_MANIFEST_NOT_FOUND: "密钥文件不存在",
  MACOS_MANIFEST_INVALID: "密钥文件无效",
  MACOS_MANIFEST_PERMISSIONS: "请检查密钥权限",
  MACOS_MANIFEST_SECURITY: "请检查密钥权限路径",
  MACOS_KEY_MISSING: "密钥不完整",
  MACOS_KEY_INVALID: "密钥验证失败",
  MACOS_SNAPSHOT_FAILED: "快照失败，请重试",
  MACOS_PARSE_FAILED: "记录解析失败",
  MACOS_SCAN_BUSY: "请等待读取完成"
};

export function scanErrorMessage(error: unknown): string {
  const value = typeof error === "string"
    ? error
    : error instanceof Error ? error.message : "";
  const code = /^\[(MACOS_[A-Z_]+)\](?:\s|$)/.exec(value)?.[1]
    ?? value.split(":", 1)[0].trim();
  if (MACOS_SCAN_MESSAGES[code]) return MACOS_SCAN_MESSAGES[code];
  if (/^MACOS_(APP|APP_TOOL|DATA|METADATA|MANIFEST)_PERMISSION$/.test(code)) {
    return "请检查访问权限";
  }
  if (code === "MACOS_APP_MISSING") return "未找到微信";
  if (/^MACOS_APP_(IDENTITY|VERSION|BUILD|PLIST|TYPE|IO)$/.test(code)
    || /^MACOS_APP_TOOL_(MISSING|IO)$/.test(code)) return "微信信息读取失败";
  if (code === "MACOS_MANIFEST_AUTH") return "密钥验证失败";
  if (code === "MACOS_MANIFEST_COVERAGE") return "密钥不完整";
  if (code === "MACOS_MANIFEST_MISSING") return "密钥文件不存在";
  if (/^MACOS_MANIFEST_(LIMIT|FORMAT|KEY_LENGTH|KEY_ENCODING|TYPE|IO)$/.test(code)) {
    return "密钥文件无效";
  }
  if (code === "MACOS_ACCOUNT_NOT_FOUND" || code === "MACOS_DATA_ROOT_MISSING"
    || code === "MACOS_DATA_MESSAGES_MISSING") return "未找到微信记录";
  if (/^MACOS_DATA_(MISSING|IO|TYPE|LAYOUT|BOUNDARY|INCOMPLETE|LIMIT)$/.test(code)) {
    return "微信记录不可读取";
  }
  if (/^MACOS_METADATA_(MISSING|IO|TYPE|LIMIT|BOUNDARY|OPEN|READ_ONLY|SCHEMA|QUERY)$/.test(code)) {
    return "密钥状态检查失败";
  }
  return "读取失败，请重试";
}
