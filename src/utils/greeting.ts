export function timeGreeting(hour: number): string {
  if (hour >= 5 && hour < 8) return "清晨好";
  if (hour >= 8 && hour < 12) return "早上好";
  if (hour >= 12 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}
