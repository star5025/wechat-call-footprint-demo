import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
export const pagesBase = "/wechat-call-footprint-demo/";

// Nothing else from public/, the repository, or a desktop build may be published.
const rootFiles = new Set(["index.html", "theme-init.js", "build-info.json"]);
const hashedAsset = /^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff|woff2)$/;
const forbiddenName = /(?:^|[\/_.-])(?:src|source|secret|secrets|credential|credentials|private|fixture|fixtures|database|db|sqlite|sql|backup|env)(?:$|[\/_.-])/i;
const forbiddenText = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/,
  /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/,
  /SQLite format 3\x00/,
  /(?:[A-Za-z]:[\\/](?:Users|Projects)[\\/]|\/home\/runner\/work\/)/
];

export function checkPagesBuild(outputDirectory = path.join(repository, "dist-pages")) {
  const failures = [];
  const files = new Set();
  const fail = (message) => failures.push(message);
  const rootStat = fs.lstatSync(outputDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("dist-pages must be a real directory, not a link");
  }

  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`Symbolic link is not publishable: ${name}`);
      } else if (entry.isDirectory()) {
        if (name !== "assets") fail(`Unexpected artifact directory: ${name}`);
        else visit(absolute, `${name}/`);
      } else if (!entry.isFile()) {
        fail(`Non-regular artifact: ${name}`);
      } else {
        files.add(name);
        if ((!rootFiles.has(name) && !hashedAsset.test(name)) || forbiddenName.test(name)) {
          fail(`Artifact is outside the static allowlist: ${name}`);
        }
        if (/\.(?:html|js|css|json|svg)$/.test(name)) {
          const text = fs.readFileSync(absolute, "utf8");
          for (const pattern of forbiddenText) {
            if (pattern.test(text)) fail(`Source map, private path, or secret marker in ${name}`);
          }
        }
      }
    }
  }
  visit(outputDirectory);

  for (const required of ["index.html", "theme-init.js"]) {
    if (!files.has(required)) fail(`Missing required artifact: ${required}`);
  }
  const html = files.has("index.html")
    ? fs.readFileSync(path.join(outputDirectory, "index.html"), "utf8")
    : "";
  const tags = html.match(/<(?:script|link|img|source)\b[^>]*>/gi) ?? [];
  const scripts = [];
  const styles = [];
  for (const tag of tags) {
    const refs = [...tag.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)];
    for (const [, reference] of refs) {
      if (!reference.startsWith(pagesBase)) {
        fail(`HTML asset must use ${pagesBase}: ${reference}`);
        continue;
      }
      const relative = reference.slice(pagesBase.length);
      if (!files.has(relative)) fail(`HTML references a missing or unsafe artifact: ${reference}`);
      if (/^<script\b/i.test(tag)) scripts.push({ relative, tag });
      if (/^<link\b/i.test(tag) && /\brel\s*=\s*["']stylesheet["']/i.test(tag)) {
        styles.push(relative);
      }
    }
  }
  if (!scripts.some(({ relative }) => relative === "theme-init.js")) {
    fail("index.html must load the base-prefixed theme-init.js script");
  }
  if (!scripts.some(({ relative, tag }) => hashedAsset.test(relative)
      && relative.endsWith(".js") && /\btype\s*=\s*["']module["']/i.test(tag))) {
    fail("index.html must load a base-prefixed hashed module script");
  }
  if (!styles.some((name) => hashedAsset.test(name) && name.endsWith(".css"))) {
    fail("index.html must load a base-prefixed hashed stylesheet");
  }
  if (/<base\b/i.test(html)) fail("Unexpected HTML base element");
  if (!/data-mode=["']pages-demo["']/.test(html)) fail("Only the Pages demo build may be published");
  const bundledJavaScript = [...files].filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(outputDirectory, name), "utf8")).join("\n");
  if (!bundledJavaScript.includes("synthetic-demo-account")) fail("Synthetic dataset is missing");
  const desktopAssets = path.join(repository, "dist", "assets");
  if (fs.existsSync(desktopAssets)) {
    for (const name of fs.readdirSync(desktopAssets).filter((name) => name.endsWith(".js"))) {
      if (fs.readFileSync(path.join(desktopAssets, name), "utf8").includes("synthetic-demo-account")) {
        fail("Desktop build must not contain the public synthetic dataset");
      }
    }
  }
  if (failures.length) throw new Error(`Pages artifact validation failed:\n- ${failures.join("\n- ")}`);

  const commit = (process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true
  })).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) {
    throw new Error("Build commit must be a full Git SHA (GITHUB_SHA or git rev-parse HEAD)");
  }
  const metadata = { commit, builtAt: new Date().toISOString(), base: pagesBase };
  fs.writeFileSync(path.join(outputDirectory, "build-info.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Pages artifacts verified: ${files.size} files; commit ${commit}; base ${pagesBase}`);
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkPagesBuild();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
