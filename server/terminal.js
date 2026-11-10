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

/* ------------------------------------------------ the Claude profile
 *
 * The sidebar's Claude button opens the terminal straight into Claude Code,
 * running inside a tmux session called "claude" as the person who installed
 * it — not as root, which is what Nexus itself runs as. Closing the tab only
 * detaches tmux, so a long job keeps going and the next press reattaches.
 *
 * Nothing from the browser reaches the command line: the profile is a fixed
 * name, the user comes from config.json (`terminal.claudeUser`) or from
 * finding the one home directory with Claude Code installed, and it must look
 * like a Unix user name before it is used. Whoever can open this already has
 * a root shell one button away, so this adds no reach; it only saves typing.
 */
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

function passwd() {
  try {
    return fs.readFileSync("/etc/passwd", "utf8").split("\n").map(l => l.split(":"))
      .filter(f => f.length >= 7).map(f => ({ user: f[0], uid: Number(f[2]), home: f[5] }));
  } catch { return []; }
}

function onPath(name, extra = []) {
  for (const d of [...extra, ...(process.env.PATH || "").split(":"), "/usr/local/bin", "/usr/bin", "/bin"]) {
    if (!d) continue;
    const p = `${d}/${name}`;
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

const claudeIn = home => [`${home}/.local/bin/claude`, `${home}/.claude/local/claude`, `${home}/.npm-global/bin/claude`]
  .find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;

/** Where Claude Code is and whose it is, or why it cannot be opened. */
export function claudeStatus() {
  if (!cfg.isLinux) return { available: false, linuxOnly: true, reason: "The Claude button works on Linux only." };
  const tmux = onPath("tmux");
  const want = cfg.terminal.claudeUser;
  if (want && !USER_RE.test(want)) return { available: false, reason: `terminal.claudeUser "${want}" is not a valid user name.` };
  const users = passwd();

  if (isRoot()) {
    // A named user first; otherwise the real people on the box (uid ≥ 1000),
    // then root itself.
    const pool = want ? users.filter(u => u.user === want)
                      : [...users.filter(u => u.uid >= 1000 && u.uid < 65534), ...users.filter(u => u.uid === 0)];
    if (want && !pool.length) return { available: false, reason: `There is no user called "${want}" on this box.` };
    for (const u of pool) {
      if (!USER_RE.test(u.user)) continue;
      const bin = claudeIn(u.home);
      if (bin) return { available: true, user: u.user, home: u.home, bin, tmux, asOther: u.uid !== 0 };
    }
  } else {
    const bin = claudeIn(homeDir()) || onPath("claude");
    if (bin) return { available: true, user: os.userInfo().username, home: homeDir(), bin, tmux, asOther: false };
  }
  return { available: false, tmux, reason: want
    ? `Claude Code is not installed for ${want}.`
    : "Claude Code is not installed for any user on this box." };
}

/** The command line the Claude profile runs, as one string for `sh -c`. */
function claudeCommand() {
  const st = claudeStatus();
  if (!st.available && st.linuxOnly) throw Object.assign(new Error(st.reason), { status: 404 });
  if (!st.available) {
    throw Object.assign(new Error(
      `${st.reason}\r\n\r\nInstall it as your normal user (not root), over SSH or in a plain terminal:\r\n` +
      `  curl -fsSL https://claude.ai/install.sh | bash\r\n` +
      `then run "claude" once to sign in, and press Claude again.` +
      (st.tmux ? "" : `\r\n\r\nAlso install tmux, so a session survives closing the tab:\r\n  sudo apt install tmux`)), { status: 404 });
  }
  // When Claude exits you land in a shell in the same tmux window, so the
  // session stays put and "claude --continue" picks the conversation back up.
  const inner = `cd ~ && ${shq(st.bin)}; exec bash -l`;
  // A login shell under runuser may have no UTF-8 locale, and then tmux draws
  // every character it thinks the terminal cannot show as "_" — Claude's logo,
  // its ❯ pointer, box drawing. xterm.js is UTF-8, so say so: a UTF-8 locale if
  // there is none, and tmux -u.
  const utf8 = `case "$LC_ALL$LC_CTYPE$LANG" in *UTF-8*|*utf8*|*UTF8*|*utf-8*) ;; *) export LANG=C.UTF-8 ;; esac; `;
  // mouse on: the wheel scrolls tmux's history (the browser terminal has none
  // of its own while tmux owns the screen). Set on this session only, and on
  // every attach, so it holds for a session made before this existed. A long
  // Claude conversation outgrows tmux's default 2000 lines of history.
  const tmux = shq(st.tmux);
  const body = st.tmux
    ? `${utf8}${tmux} -u start-server \\; set-option -g history-limit 50000 \\; ` +
      `new-session -A -s claude ${shq(inner)} \\; set-option -t claude mouse on`
    : `${utf8}printf '\\033[33m[nexus] tmux is not installed, so this session ends when you close the tab. sudo apt install tmux\\033[0m\\n'; ${inner}`;
  return st.asOther ? `runuser -l ${st.user} -c ${shq(body)}` : `bash -lc ${shq(body)}`;
}

export function open({ cols = 80, rows = 24, onData, onExit, profile = "shell" }) {
  if (!cfg.terminal.enabled) {
    throw Object.assign(new Error("terminal is disabled in the server config"), { status: 403 });
  }

  const id = nextId++;
  const shell = shellName();
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG || "C.UTF-8" };
  // The Claude profile is a fixed command line; the plain shell is the shell.
  const command = profile === "claude" ? claudeCommand() : null;

  let impl;

  if (ptyLib) {
    const p = ptyLib.spawn(command ? "/bin/sh" : shell, command ? ["-c", command] : [], {
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
      ? spawn("script", ["-qfc", command || shell, "/dev/null"], { cwd: homeDir(), env: scriptEnv })
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
    id, cols, rows, backend: backendName(), startedAt: Date.now(), profile: command ? "claude" : "shell",
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
