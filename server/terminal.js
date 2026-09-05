import { spawn } from "node:child_process";
import os from "node:os";
import cfg from "./config.js";

/**
 * PTY sessions without a native module.
 *
 * node-pty would be the obvious choice, but it is a native addon: installing it
 * on the target box needs python and a C++ toolchain, which is exactly the kind
 * of deploy friction this project is trying to avoid.
 *
 * Instead we borrow `script` from util-linux (present on every Ubuntu install).
 * `script -qfc <cmd> /dev/null` allocates a real pty and wires it to our stdio,
 * so we get proper line editing, colours, curses apps and job control for free.
 *
 * Trade-off: window resize (SIGWINCH) cannot be forwarded the way node-pty does
 * it. We set an initial COLUMNS/LINES and re-send `stty` on resize, which covers
 * the common cases (htop, vim) well enough.
 */

const sessions = new Map();
let nextId = 1;

export function enabled() { return cfg.terminal.enabled; }

export function open({ cols = 80, rows = 24, onData, onExit }) {
  if (!cfg.terminal.enabled) throw Object.assign(new Error("terminal is disabled"), { status: 403 });

  const shell = cfg.terminal.shell || process.env.SHELL || (cfg.isLinux ? "/bin/bash" : null);
  const id = nextId++;
  let child;

  if (cfg.isLinux) {
    child = spawn("script", ["-qfc", shell, "/dev/null"], {
      cwd: process.env.HOME || "/root",
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: String(cols), LINES: String(rows) }
    });
  } else {
    // Windows dev fallback: no pty, but a usable shell for exercising the
    // transport end to end while developing.
    child = spawn(process.env.COMSPEC || "cmd.exe", [], {
      env: { ...process.env, TERM: "xterm-256color" }
    });
  }

  child.stdout.on("data", d => onData(d));
  child.stderr.on("data", d => onData(d));
  child.on("exit", code => { sessions.delete(id); onExit?.(code); });
  child.on("error", err => { onData(Buffer.from(`\r\n[nexus] failed to start shell: ${err.message}\r\n`)); sessions.delete(id); onExit?.(1); });

  const s = {
    id, child, cols, rows,
    startedAt: Date.now(),
    write(data) { try { child.stdin.write(data); } catch {} },
    resize(c, r) {
      this.cols = c; this.rows = r;
      // Best-effort: ask the shell itself to update its idea of the window.
      if (cfg.isLinux) { try { child.stdin.write(`stty cols ${c} rows ${r} 2>/dev/null\n`); } catch {} }
    },
    kill() { try { child.kill("SIGHUP"); } catch {} sessions.delete(id); }
  };
  sessions.set(id, s);
  return s;
}

export function activeCount() { return sessions.size; }

export function killAll() {
  for (const s of sessions.values()) s.kill();
}

export function shellName() {
  return cfg.terminal.shell || process.env.SHELL || (cfg.isLinux ? "/bin/bash" : (process.env.COMSPEC || "cmd.exe"));
}

export { os };
