import type { CallEvent } from "@contracts/models";
import { isConnected } from "@/data/analytics";

export function durationDistribution(events: CallEvent[]) {
  const buckets = [
    { label: "5 分钟以内", count: 0 },
    { label: "5–15 分钟", count: 0 },
    { label: "15–30 分钟", count: 0 },
    { label: "30 分钟以上", count: 0 }
  ];
  for (const event of events) {
    const seconds = event.connectedDurationSeconds;
    if (event.excluded || !isConnected(event) || seconds === null || !Number.isFinite(seconds) || seconds <= 0) continue;
    const index = seconds < 300 ? 0 : seconds < 900 ? 1 : seconds <= 1800 ? 2 : 3;
    buckets[index].count += 1;
  }
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const max = Math.max(...buckets.map((bucket) => bucket.count));
  const leaders = buckets.filter((bucket) => max > 0 && bucket.count === max);
  return { total, max, leaders, buckets: buckets.map((bucket) => ({ ...bucket, percent: total ? Math.round(bucket.count / total * 100) : 0 })) };
}
