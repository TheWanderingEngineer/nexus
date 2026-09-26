import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
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
 *     editing and curses apps work). `script` owns the pty master, so we cannot
 *     resize it directly — instead we find the pty the shell is sitting on and
 *     run `stty -F /dev/pts/N` against it from outside. See scriptResizer().
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
export function supportsResize() { return !!ptyLib || (cfg.isLinux && fs.existsSync("/proc/self/fd")); }

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
    // No COLUMNS/LINES in the environment. ncurses prefers them over the pty's
    // real size, so an exported 80x24 would pin nano and htop to 80x24 however
    // the window is resized. The size is set on the pty itself instead.
    const scriptEnv = { ...env };
    delete scriptEnv.COLUMNS;
    delete scriptEnv.LINES;

    const child = cfg.isLinux
      ? spawn("script", ["-qfc", shell, "/dev/null"], { cwd: homeDir(), env: scriptEnv })
      : spawn(shell, [], { env });

    const resizer = cfg.isLinux ? scriptResizer(child) : null;
    resizer?.resize(cols, rows);

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", code => { resizer?.stop(); sessions.delete(id); onExit?.(code ?? 0); });
    child.on("error", err => {
      resizer?.stop();
      onData(Buffer.from(`\r\n[nexus] could not start ${shell}: ${err.message}\r\n`));
      sessions.delete(id);
      onExit?.(1);
    });

    impl = {
      write: d => { try { child.stdin.write(d); } catch {} },
      resize: (c, r) => resizer?.resize(c, r),
      kill: () => { resizer?.stop(); try { child.kill("SIGHUP"); } catch {} }
    };
  }

  const session = {
    id, cols, rows, backend: backendName(), startedAt: Date.now(),
    write: impl.write,
    resize(c, r) {
      c = Math.max(2, Math.min(1000, Math.round(Number(c)) || 80));
      r = Math.max(1, Math.min(500, Math.round(Number(r)) || 24));
      this.cols = c; this.rows = r; impl.resize(c, r);
    },
    kill() { impl.kill(); sessions.delete(id); }
  };
  sessions.set(id, session);
  return session;
}

/* ------------------------------------------------ resizing without node-pty */

/**
 * Window size for the `script` backend, set on the pty rather than typed in.
 *
 * This used to write `stty cols X rows Y` into the shell's stdin. That echoed
 * a line into the terminal on every resize, and when nano or htop was in the
 * foreground it went into *them* as keystrokes — typed into the file being
 * edited. Never write a resize into the input stream.
 *
 * Instead: find the pty the shell is attached to (its stdin, /dev/pts/N) and
 * run `stty -F /dev/pts/N cols X rows Y` as a separate process. That is the
 * TIOCSWINSZ ioctl, so the kernel sends SIGWINCH to whatever is in the
 * foreground and it redraws at the new size — exactly what node-pty does.
 *
 * If the pty cannot be found, the resize is dropped rather than falling back
 * to keystrokes. A terminal at the wrong size is a nuisance; one that types
 * into your files is not acceptable.
 */
function scriptResizer(child) {
  let tty = null;
  let want = null;         // latest size asked for
  let applied = "";        // last size actually set, as "COLSxROWS"
  let timer = null;
  let tries = 0;
  let busy = false;
  let stopped = false;

  const apply = () => {
    timer = null;
    if (stopped || busy || !want) return;

    tty = tty || findShellTty(child.pid);
    if (!tty) {
      // `script` forks the shell a moment after it starts, and the browser's
      // first resize usually arrives before that. Wait for it, briefly.
      if (++tries <= 30) timer = setTimeout(apply, 100);
      else if (!warnedNoTty) {
        warnedNoTty = true;
        console.error("[terminal] could not find the shell's pty under /proc; terminal resize is unavailable");
      }
      return;
    }

    const key = `${want.cols}x${want.rows}`;
    if (key === applied) return;
    busy = true;
    execFile("stty", ["-F", tty, "cols", String(want.cols), "rows", String(want.rows)], { timeout: 3000 }, err => {
      busy = false;
      if (err) return;
      applied = key;
      // A newer size may have arrived while stty was running.
      if (want && `${want.cols}x${want.rows}` !== applied) apply();
    });
  };

  return {
    resize(cols, rows) {
      want = { cols, rows };
      tries = 0;
      if (!timer) apply();
    },
    stop() { stopped = true; clearTimeout(timer); }
  };
}

let warnedNoTty = false;

/** The /dev/pts/N the shell under `script` has as its stdin, or null. */
function findShellTty(scriptPid) {
  if (!scriptPid) return null;
  for (const pid of childPids(scriptPid)) {
    try {
      const t = fs.readlinkSync(`/proc/${pid}/fd/0`);
      if (/^\/dev\/pts\/\d+$/.test(t)) return t;
    } catch {}
  }
  return null;
}

function childPids(pid) {
  try {
    const list = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
    if (list) return list.split(/\s+/);
  } catch {}
  // Kernels built without CONFIG_PROC_CHILDREN: find them by parent pid. The
  // process name in /proc/N/stat can contain spaces and parens, so the fields
  // are read from after its closing paren.
  const out = [];
  try {
    for (const d of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${d}/stat`, "utf8");
        const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        if (ppid === pid) out.push(d);
      } catch {}
    }
  } catch {}
  return out;
}

export function activeCount() { return sessions.size; }
export function killAll() { for (const s of [...sessions.values()]) s.kill(); }
