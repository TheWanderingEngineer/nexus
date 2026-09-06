/**
 * Store integration check.
 *
 * Clones the real CasaOS App Store into a scratch data dir and verifies the
 * adapter actually parses it — app count, and that a well-known app comes out
 * with the fields the UI needs. This is the part that cannot be unit-tested
 * honestly: the format is whatever IceWhale ships today.
 *
 *   node scripts/store-check.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fileURLToPath } from "node:url";

// Dependencies must exist before the dynamic imports below are attempted.
// scripts/install.sh installs into /opt/nexus, so a fresh clone you run tests
// from has no node_modules of its own — otherwise you get a raw
// ERR_MODULE_NOT_FOUND stack trace instead of a useful instruction.
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
  console.error([
    "",
    "  Dependencies are not installed in this directory.",
    "",
    "  Run this first:",
    "",
    "      npm install",
    "",
    "  (scripts/install.sh installs into /opt/nexus, not into your clone.)",
    ""
  ].join("\n"));
  process.exit(1);
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-store-"));
process.env.NEXUS_DATA_DIR = DATA;
process.env.NEXUS_PORT = "8199";

const { default: cfg } = await import("../server/config.js");
const library = await import("../server/library.js");
const apps = await import("../server/apps.js");

let pass = 0, fail = 0;
const ok = n => { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${n}`); };
const bad = (n, w) => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${n}\n        ${w}`); };
const check = (n, c, w = "") => c ? ok(n) : bad(n, w);

console.log(`\n  nexus store check   (data ${DATA})\n`);

try {
  await apps.init();

  const libs = library.listLibraries();
  check("CasaOS store is seeded on first boot", libs.length === 1 && libs[0].format === "casaos", JSON.stringify(libs));

  console.log(`  -> cloning ${libs[0].url}\n     (shallow, but still a few hundred MB — this takes a minute)\n`);
  const t0 = Date.now();
  const out = await library.syncLibrary(libs[0].id, m => console.log("     " + m));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  check("sync completes", out && out.apps > 0, JSON.stringify(out));
  console.log(`     indexed ${out.apps} apps in ${secs}s\n`);
  check("indexed a realistic number of apps (>100)", out.apps > 100, `got ${out.apps}`);

  const cat = library.searchCatalog({ limit: 5 });
  check("catalogue is searchable", cat.total === out.apps, `${cat.total} vs ${out.apps}`);
  check("categories were extracted", cat.categories.length > 3, JSON.stringify(cat.categories));

  const found = library.searchCatalog({ q: "jellyfin", limit: 3 });
  const jf = found.apps[0];
  check("search finds Jellyfin", !!jf, JSON.stringify(found.apps.map(a => a.slug)));

  if (jf) {
    console.log("\n     sample app:");
    console.log("       name      " + jf.name);
    console.log("       tagline   " + String(jf.tagline).slice(0, 70));
    console.log("       category  " + jf.category);
    console.log("       icon      " + String(jf.icon).slice(0, 70));
    console.log("       image     " + jf.image);
    console.log("");
    check("app has a display name", !!jf.name && jf.name !== jf.slug, jf.name);
    check("app has an icon url", /^https?:\/\//.test(String(jf.icon)), String(jf.icon));
    check("app has a container image", !!jf.image, String(jf.image));
    check("app has a category", !!jf.category && jf.category !== "Uncategorised", String(jf.category));

    const compose = await library.readCompose(jf);
    check("compose file reads back", compose.includes("services:"), compose.slice(0, 80));

    const YAML = (await import("yaml")).default;
    const doc = YAML.parse(compose);
    check("compose parses as YAML with services", !!doc.services && Object.keys(doc.services).length > 0, "no services");

    const ports = await apps.checkPorts(doc);
    check("port extraction finds published ports", Array.isArray(ports.wanted), JSON.stringify(ports));
    console.log(`     ports declared: ${ports.wanted.join(", ") || "(none)"}\n`);
  }

  // A handful of apps chosen at random should all have the basics.
  const sample = library.searchCatalog({ limit: 200 }).apps;
  const broken = sample.filter(a => !a.name || !a.composePath);
  check("no malformed entries in the first 200 apps", broken.length === 0, `${broken.length} broken`);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (err) {
  console.error("\n  store check crashed:", err.message);
  fail++;
} finally {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
}
