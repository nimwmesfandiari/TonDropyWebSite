// Syntax-checks every .js/.mjs file and every inline <script type="module"> in the HTML pages.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const roots = ["backend", "frontend", "scripts"];
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
}
roots.forEach(walk);

const tmp = mkdtempSync(join(tmpdir(), "syntax-"));
let failed = 0;
let n = 0;
function check(path, label) {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  n++;
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${label}\n${r.stderr}`);
  }
}

for (const f of files) {
  const ext = extname(f);
  if (ext === ".js" || ext === ".mjs") check(f, f);
  if (ext === ".html") {
    const html = readFileSync(f, "utf8");
    [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].forEach((m, i) => {
      const tmpFile = join(tmp, `${n}-${i}.mjs`);
      writeFileSync(tmpFile, m[1]);
      check(tmpFile, `${f} (inline script ${i + 1})`);
    });
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
