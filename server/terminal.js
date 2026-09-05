import { spawn } from "node:child_process";
import os from "node:os";
import cfg from "./config.js";

/**
 * PTY sessions, with two backends.
 *
 *  1. node-pty  — a real pty with working SIGWINCH, so htop/vim/less resize
 *     correctly. It is a native addon, so it lives in optionalDependencies:
 *     if the target box has no compiler, npm skips it and install still works.
 *
 *  2. `script -qfc $SHELL /dev/null` — util-linux, present on every Ubuntu
 *     install, no build step. It still allocates a real pty (so colours, line
 *     editing and curses apps work), but the window size can only be pushed in
 *     with `stty`, which lands as literal keystrokes if a full-screen program is
 *     already running. Resize is therefore best-effort on this backend.
 *
 * Which one is active is reported in /api/system/info so the UI can say so
 * rather than leaving you guessing why htop looks wrong.
 */

let ptyLib = null;
let backend = "script";

try {
  const mod = await import("node-pty");
  ptyLib = mod.default ?? mod;
  if (typeof ptyLib.spawn === "function") backend = "node-pty";
  else ptyLib = null;
} catch {
  ptyLib = null;   // not built for this platform; the fallback covers us
}

const sessions = new Map();
let nextId = 1;

export function enabled() { return cfg.terminal.enabled; }
export function backendName() { return ptyLib ? "node-pty" : "script"; }
export function supportsResize() { return !!ptyLib; }

export function shellName() {
  if (cfg.terminal.shell) return cfg.terminal.shell;
  if (process.platform === "win32") return process.env.COMSPEC || "cmd.exe";
  return process.env.SHELL || "/bin/bash";
}

function homeDir() {
  try { return process.env.HOME || os.homedir(); } catch { return "/"; }
}

export function open({ cols = 80, rows = 24, onData, onExit }) {
  if (!cfg.terminal.enabled) {
    throw Object.assign(new Error("terminal is disabled in the server config"), { status: 403 });
  }

  const id = nextId++;
  const shell = shellName();
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG || "C.UTF-8" };

  let impl;

  if (ptyLib) {
    const p = ptyLib.spawn(shell, [], {
      name: "xterm-256color",
      cols, rows,
      cwd: homeDir(),
      env
    });
    p.onData(d => onData(typeof d === "string" ? Buffer.from(d, "utf8") : d));
    p.onExit(({ exitCode }) => { sessions.delete(id); onExit?.(exitCode ?? 0); });

    impl = {
      write: d => { try { p.write(typeof d === "string" ? d : d.toString("utf8")); } catch {} },
      resize: (c, r) => { try { p.resize(Math.max(2, c), Math.max(1, r)); } catch {} },
      kill: () => { try { p.kill(); } catch {} }
    };

  } else {
    const child = cfg.isLinux
      ? spawn("script", ["-qfc", shell, "/dev/null"], { cwd: homeDir(), env: { ...env, COLUMNS: String(cols), LINES: String(rows) } })
      : spawn(shell, [], { env });

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", code => { sessions.delete(id); onExit?.(code ?? 0); });
    child.on("error", err => {
      onData(Buffer.from(`\r\n[nexus] could not start ${shell}: ${err.message}\r\n`));
      sessions.delete(id);
      onExit?.(1);
    });

    impl = {
      write: d => { try { child.stdin.write(d); } catch {} },
      resize: (c, r) => {
        // Only meaningful at a shell prompt — see the note at the top.
        if (cfg.isLinux) { try { child.stdin.write(`stty cols ${c} rows ${r} 2>/dev/null\n`); } catch {} }
      },
      kill: () => { try { child.kill("SIGHUP"); } catch {} }
    };
  }

  const session = {
    id, cols, rows, backend: backendName(), startedAt: Date.now(),
    write: impl.write,
    resize(c, r) { this.cols = c; this.rows = r; impl.resize(c, r); },
    kill() { impl.kill(); sessions.delete(id); }
  };
  sessions.set(id, session);
  return session;
}

export function activeCount() { return sessions.size; }
export function killAll() { for (const s of [...sessions.values()]) s.kill(); }
