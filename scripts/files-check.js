/** Exercises files.js read/write/conflict directly, with no HTTP in the way. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NEXUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ft-"));
const files = await import("../../../../../../E:/Downloads-E/homelab dashboard/server/files.js")
  .catch(() => import("file:///E:/Downloads-E/homelab%20dashboard/server/files.js"));

const P = path.join(os.homedir(), "nexus-editor-test.txt");
let pass = 0, fail = 0;
const ok = n => { pass++; console.log("  PASS  " + n); };
const bad = (n, w) => { fail++; console.log("  FAIL  " + n + "\n        " + w); };
const check = (n, c, w = "") => c ? ok(n) : bad(n, w);

console.log("\n  files.js read/write check\n");

try {
  fs.writeFileSync(P, "original line one\noriginal line two\n");

  const r1 = await files.readText(P);
  check("reads a text file", r1.content.startsWith("original line one"), JSON.stringify(r1.content));

  const w1 = await files.writeText(P, "EDITED BY NEXUS\nsecond line changed\n", r1.mtime);
  check("writes with a matching mtime", w1.size > 0, JSON.stringify(w1));

  const onDisk = fs.readFileSync(P, "utf8");
  check("the change actually reached the disk", onDisk === "EDITED BY NEXUS\nsecond line changed\n", JSON.stringify(onDisk));

  // The stale mtime from before the write must now be refused.
  let conflicted = false;
  try { await files.writeText(P, "SHOULD NOT LAND", r1.mtime); }
  catch (e) { conflicted = e.status === 409; }
  check("stale mtime is rejected (409)", conflicted, "no conflict raised");
  check("rejected write left the file untouched",
        fs.readFileSync(P, "utf8") === "EDITED BY NEXUS\nsecond line changed\n", "file was clobbered");

  // A second save in the same session, using the mtime the write returned.
  const w2 = await files.writeText(P, "third save\n", w1.mtime);
  check("consecutive save with the returned mtime succeeds", w2.size > 0, JSON.stringify(w2));

  // Path jail still applies to the new endpoints.
  let jailed = false;
  try { await files.readText("C:\\Windows\\System32\\drivers\\etc\\hosts"); }
  catch (e) { jailed = e.status === 403; }
  check("read is path-jailed", jailed, "escaped the root");

  let jailedW = false;
  try { await files.writeText("C:\\Windows\\nexus-should-not-exist.txt", "x"); }
  catch (e) { jailedW = e.status === 403; }
  check("write is path-jailed", jailedW, "escaped the root");

  // Binary refusal.
  const bin = path.join(os.homedir(), "nexus-bin-test.bin");
  fs.writeFileSync(bin, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41, 0x42]));
  let binRefused = false;
  try { await files.readText(bin); } catch (e) { binRefused = e.status === 415; }
  check("binary file is refused (415)", binRefused, "binary was opened as text");
  fs.rmSync(bin, { force: true });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (err) {
  console.error("  crashed: " + err.message);
  fail++;
} finally {
  fs.rmSync(P, { force: true });
  fs.rmSync(process.env.NEXUS_DATA_DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
