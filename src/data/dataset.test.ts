import { describe, expect, it } from "vitest";
import { anonymizeDataset, parseDataset, validateDataset } from "@/data/dataset";
import { DEMO_DATASET } from "@/data/demoDataset";

describe("dataset validation", () => {
  it("accepts the built-in v1 dataset", () => {
    const result = validateDataset(DEMO_DATASET);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects malformed JSON", () => {
    const result = parseDataset("{not-json");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("无法解析");
  });

  it("rejects unsupported contract majors", () => {
    const result = validateDataset({ ...DEMO_DATASET, contractVersion: "2.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("契约主版本");
  });

  it("removes identity data from anonymized exports", () => {
    const result = anonymizeDataset(DEMO_DATASET);
    expect(result.account.displayName).toBe("匿名账号");
    expect(result.contacts[0].displayName).toBe("匿名联系人 1");
    expect(result.contacts[0].aliases).toEqual([]);
    expect(result.events[0].contactSnapshot.displayName).toBe("匿名联系人 1");
    expect(result.events[0].lineage.sourceRefs[0].sourceRecordIdHash).toBe("redacted-record-id");
    expect(result.account.id).not.toBe(DEMO_DATASET.account.id);
    expect(result.contacts[0].id).not.toBe(DEMO_DATASET.contacts[0].id);
    expect(result.events[0].id).not.toBe(DEMO_DATASET.events[0].id);
    expect(result.events[0].lineage.sourceRefs[0].sourceId).not.toBe(
      DEMO_DATASET.events[0].lineage.sourceRefs[0].sourceId
    );
    expect(validateDataset(result).valid).toBe(true);
  });
});
