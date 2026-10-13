import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const contractRoot = path.join(root, "contracts", "v1");
const schemaRoot = path.join(contractRoot, "schemas");
const exampleRoot = path.join(contractRoot, "examples");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${path.relative(root, file)}: invalid JSON (${error.message})`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") refs.push(child);
      else collectRefs(child, refs);
    }
  }
  return refs;
}

const schemaFiles = fs
  .readdirSync(schemaRoot)
  .filter((name) => name.endsWith(".schema.json"));
const schemas = new Map();

for (const name of schemaFiles) {
  const schema = readJson(path.join(schemaRoot, name));
  if (!schema) continue;
  schemas.set(name, schema);
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema", `${name}: unexpected JSON Schema dialect`);
  assert(typeof schema.$id === "string", `${name}: missing $id`);

  for (const ref of collectRefs(schema)) {
    if (ref.startsWith("#") || ref.startsWith("http")) continue;
    const [target] = ref.split("#");
    assert(fs.existsSync(path.join(schemaRoot, target)), `${name}: unresolved $ref ${ref}`);
  }
}

const callSchema = schemas.get("call-event.schema.json");
const commonSchema = schemas.get("common.schema.json");
const wallSchema = schemas.get("contribution-wall.schema.json");
assert(Boolean(callSchema && commonSchema && wallSchema), "required schemas are missing");

const call = readJson(path.join(exampleRoot, "call-event.json"));
if (call && callSchema) {
  for (const field of callSchema.required ?? []) {
    assert(Object.hasOwn(call, field), `call-event example: missing required field ${field}`);
  }
  assert(call.connectedDurationSeconds === null || call.connectedDurationSeconds >= 0, "call-event example: negative duration");
  assert(commonSchema.$defs.mediaType.enum.includes(call.mediaType), "call-event example: invalid mediaType");
  assert(commonSchema.$defs.direction.enum.includes(call.direction), "call-event example: invalid direction");
  assert(commonSchema.$defs.outcome.enum.includes(call.outcome), "call-event example: invalid outcome");
  assert(call.contactId !== null || call.qualityFlags.includes("unknown_contact"), "call-event example: null contact requires unknown_contact");
  assert(call.lineage.sourceRefs.length > 0, "call-event example: lineage must have a source");
}

const wall = readJson(path.join(exampleRoot, "contribution-wall.json"));
if (wall && wallSchema) {
  for (const field of wallSchema.required ?? []) {
    assert(Object.hasOwn(wall, field), `contribution-wall example: missing required field ${field}`);
  }
  const sorted = [...wall.days].sort((a, b) => a.date.localeCompare(b.date));
  assert(JSON.stringify(sorted) === JSON.stringify(wall.days), "contribution-wall example: days are not sorted");

  for (let i = 1; i < wall.days.length; i += 1) {
    const previous = new Date(`${wall.days[i - 1].date}T12:00:00Z`);
    const current = new Date(`${wall.days[i].date}T12:00:00Z`);
    assert((current - previous) / 86400000 === 1, `contribution-wall example: date gap before ${wall.days[i].date}`);
  }

  const totals = wall.days.reduce(
    (acc, day) => ({
      calls: acc.calls + day.callCount,
      connected: acc.connected + day.connectedCount,
      duration: acc.duration + day.durationSeconds
    }),
    { calls: 0, connected: 0, duration: 0 }
  );
  assert(totals.calls === wall.summary.attemptedCount, "contribution-wall example: attempted count mismatch");
  assert(totals.connected === wall.summary.connectedCount, "contribution-wall example: connected count mismatch");
  assert(totals.duration === wall.summary.totalDurationSeconds, "contribution-wall example: duration mismatch");
  assert(wall.days[0]?.date === wall.range.startDate, "contribution-wall example: first day differs from startDate");
  assert(wall.days.at(-1)?.date === wall.range.endDate, "contribution-wall example: last day differs from endDate");
}

const typeSource = fs.readFileSync(path.join(contractRoot, "models.ts"), "utf8");
for (const value of commonSchema?.$defs.mediaType.enum ?? []) {
  assert(typeSource.includes(`"${value}"`), `models.ts: missing mediaType ${value}`);
}
for (const value of commonSchema?.$defs.outcome.enum ?? []) {
  assert(typeSource.includes(`"${value}"`), `models.ts: missing outcome ${value}`);
}
for (const value of commonSchema?.$defs.qualityFlag.enum ?? []) {
  assert(typeSource.includes(`"${value}"`), `models.ts: missing quality flag ${value}`);
}

if (failures.length) {
  console.error(`Contract validation failed (${failures.length}):`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`Contract validation passed: ${schemaFiles.length} schemas, 2 examples.`);
