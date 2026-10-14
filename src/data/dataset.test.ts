import { describe, expect, it } from "vitest";
import { anonymizeDataset, parseDataset, validateDataset } from "@/data/dataset";
import { TEST_DATASET } from "@/data/testDataset.fixture";
import { createEmptyDataset } from "@/data/emptyDataset";

describe("dataset validation", () => {
  it("accepts the empty first-use dataset", () => {
    const result = validateDataset(createEmptyDataset());
    expect(result.valid).toBe(true);
    expect(result.dataset?.contacts).toEqual([]);
    expect(result.dataset?.events).toEqual([]);
  });

  it("accepts the built-in v1 dataset", () => {
    const result = validateDataset(TEST_DATASET);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects malformed JSON", () => {
    const result = parseDataset("{not-json");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("无法解析");
  });

  it("rejects unsupported contract majors", () => {
    const result = validateDataset({ ...TEST_DATASET, contractVersion: "2.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("契约主版本");
  });

  it("removes identity data from anonymized exports", () => {
    const result = anonymizeDataset(TEST_DATASET);
    expect(result.account.displayName).toBe("匿名账号");
    expect(result.contacts[0].displayName).toBe("匿名联系人 1");
    expect(result.contacts[0].aliases).toEqual([]);
    expect(result.events[0].contactSnapshot.displayName).toBe("匿名联系人 1");
    expect(result.events[0].lineage.sourceRefs[0].sourceRecordIdHash).toBe("redacted-record-id");
    expect(result.account.id).not.toBe(TEST_DATASET.account.id);
    expect(result.contacts[0].id).not.toBe(TEST_DATASET.contacts[0].id);
    expect(result.events[0].id).not.toBe(TEST_DATASET.events[0].id);
    expect(result.events[0].lineage.sourceRefs[0].sourceId).not.toBe(
      TEST_DATASET.events[0].lineage.sourceRefs[0].sourceId
    );
    expect(validateDataset(result).valid).toBe(true);
  });
});
