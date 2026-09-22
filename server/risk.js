/**
 * How dangerous is this command?
 *
 * The agent can be given a root shell. "Are you sure?" on every command trains
 * the owner to press ALLOW without reading, and the one command that mattered
 * goes through with all the others. So each command is classified, the level is
 * shown on the approval card with the reason it was given, and the owner can
 * say which levels are worth interrupting them for.
 *
 * Four levels:
 *
 *   low       reads something and changes nothing
 *   medium    changes something that can be put back
 *   high      stops a service, deletes a file, changes permissions or the network
 *   critical  destroys data, repartitions, powers the machine off, or runs
 *             something fetched from the internet
 *
 * Three rules keep this honest:
 *
 * 1. **Unknown is not safe.** A command nothing here recognises is `medium`,
 *    never `low`. A classifier that guesses "harmless" is worse than none.
 * 2. **A pipeline is as dangerous as its worst part.** `ls | xargs rm -rf` is
 *    not an `ls`.
 * 3. **Every level comes with its reasons**, in the owner's words, so the card
 *    says *why* and can be argued with rather than believed.
 *
 * This is a guide, not a sandbox. It reduces how often the owner is asked so
 * that when they are asked, they read it. It does not stop anything by itself —
 * the approval gate does that.
 */

export const LEVELS = ["low", "medium", "high", "critical"];
export const worst = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);
export const atLeast = (level, threshold) => LEVELS.indexOf(level) >= LEVELS.indexOf(threshold);

/**
 * Paths where a write or a delete stops being a mistake and becomes an outage.
 *
 * Two lists, because the difference matters: anything *under* /etc is the
 * system, but /home/you/tmp is just a folder. Treating every path under /home
 * as critical is how a classifier becomes noise.
 */
const SYSTEM_PREFIXES = ["/etc", "/boot", "/usr", "/bin", "/sbin", "/lib", "/lib64",
                         "/dev", "/proc", "/sys", "/var/lib/docker", "/var/lib/nexus"];
const SYSTEM_EXACT = ["/", "/*", "/var", "/var/lib", "/opt", "/root", "/home", "/srv",
                      "~", "~/", "$HOME", "/DATA", "/mnt", "/media"];

const READ_ONLY = new Set([
  "ls", "dir", "cat", "bat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg",
  "awk", "sed", "cut", "sort", "uniq", "wc", "diff", "stat", "file", "which", "whereis", "type",
  "df", "du", "free", "ps", "top", "htop", "uptime", "uname", "hostname", "whoami", "id", "groups",
  "date", "env", "printenv", "echo", "printf", "pwd", "readlink", "realpath", "basename", "dirname",
  "lsblk", "blkid", "lscpu", "lsusb", "lspci", "lsof", "ss", "netstat", "ip", "ifconfig", "arp",
  "ping", "traceroute", "dig", "nslookup", "host", "journalctl", "dmesg", "last", "w", "who",
  "sensors", "smartctl", "nvidia-smi", "vmstat", "iostat", "mpstat", "pidof", "pgrep",
  "md5sum", "sha256sum", "jq", "yq", "tree", "getent", "locale", "ffprobe", "mediainfo", "exiftool"
]);

const MEDIUM_CMDS = new Set([
  "mkdir", "touch", "cp", "ln", "tee", "install", "unzip", "tar", "gzip", "gunzip", "zip",
  "git", "npm", "npx", "pnpm", "yarn", "pip", "pip3", "cargo", "go", "make",
  "wget", "curl", "rsync", "scp", "sftp", "nano", "vi", "vim", "python", "python3", "node", "bash", "sh"
]);

const HIGH_CMDS = new Set([
  "rm", "rmdir", "mv", "truncate", "shred", "chmod", "chown", "chgrp", "chattr",
  "kill", "pkill", "killall", "crontab", "at", "iptables", "ip6tables", "nft", "ufw",
  "firewall-cmd", "mount", "umount", "swapoff", "modprobe", "rmmod", "insmod",
  "useradd", "usermod", "groupadd", "sysctl", "update-grub", "grub-install"
]);

const CRITICAL_CMDS = new Set([
  "shutdown", "reboot", "poweroff", "halt", "mkfs", "fdisk", "sfdisk", "sgdisk", "parted",
  "wipefs", "badblocks", "userdel", "groupdel", "passwd", "chpasswd", "visudo", "zpool", "lvremove",
  "vgremove", "pvremove", "cryptsetup"
]);

/** Strip the wrappers that do not change what is being run. */
function head(tokens) {
  const skip = new Set(["sudo", "doas", "nohup", "time", "nice", "ionice", "exec", "command", "env", "eval", "xargs", "setsid", "stdbuf", "timeout"]);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }   // FOO=bar cmd
    if (skip.has(t)) {
      // `timeout 30 cmd` and `xargs -0 cmd` carry arguments of their own.
      i++;
      while (i < tokens.length && tokens[i].startsWith("-")) i++;
      if (tokens[i - 1] === "timeout" || /^\d+[smhd]?$/.test(tokens[i] || "")) { /* fallthrough */ }
      continue;
    }
    break;
  }
  return { name: (tokens[i] || "").split("/").pop(), rest: tokens.slice(i + 1), at: i };
}

/** Good enough tokenising for classification: quotes hold together, nothing is executed. */
function tokenise(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Split on the operators that start a new command. */
function segments(command) {
  return String(command)
    .split(/\n|;|&&|\|\||\||&(?!>)/g)
    .map(s => s.trim())
    .filter(Boolean);
}

const touchesSystemPath = args => args.some(raw => {
  const a = raw.replace(/\/+$/, "") || "/";
  return SYSTEM_EXACT.includes(a) || SYSTEM_PREFIXES.some(p => a === p || a.startsWith(p + "/"));
});

/**
 * Classify one command line.
 * @returns {{level: string, why: string[], summary: string}}
 */
export function classifyCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return { level: "low", why: ["nothing to run"], summary: "empty command" };

  let level = "low";
  const why = [];
  const raise = (to, reason) => { level = worst(level, to); if (reason && !why.includes(reason)) why.push(reason); };

  // Whole-line shapes first: these matter more than which binary starts the line.
  if (/\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/.test(cmd) || /\|\s*(sudo\s+)?python3?\b/.test(cmd)) {
    raise("critical", "runs something downloaded straight through a shell");
  }
  if (/:\s*\(\s*\)\s*\{.*\|.*&.*\}\s*;?\s*:/.test(cmd)) raise("critical", "fork bomb");
  if (/>\s*\/dev\/(sd|nvme|hd|mmcblk|vd)/.test(cmd)) raise("critical", "writes directly to a disk device");
  if (/\bof=\/dev\//.test(cmd)) raise("critical", "dd writing to a device");
  if (/>{1,2}\s*\/(etc|boot|usr|lib|sbin|bin)\//.test(cmd)) raise("high", "writes into a system directory");
  if (/\bcurl\b|\bwget\b/.test(cmd) && /\bhttp/.test(cmd)) raise("medium", "fetches something from the internet");

  for (const seg of segments(cmd)) {
    const tokens = tokenise(seg);
    if (!tokens.length) continue;
    const { name, rest } = head(tokens);
    if (!name) continue;
    const args = rest.filter(a => !a.startsWith("-"));
    const flags = rest.filter(a => a.startsWith("-")).join(" ");
    const recursive = /(^|\s)-\w*[rR]/.test(flags) || flags.includes("--recursive");
    const forced = /(^|\s)-\w*f/.test(flags) || flags.includes("--force");

    if (CRITICAL_CMDS.has(name) || name.startsWith("mkfs")) {
      raise("critical", `${name} — not reversible`);
      continue;
    }

    if (name === "rm") {
      if (recursive && touchesSystemPath(args)) raise("critical", "recursive delete of a system path");
      else if (recursive) raise("high", forced ? "forced recursive delete" : "recursive delete");
      else raise("high", "deletes files");
      continue;
    }

    if (name === "chmod" || name === "chown") {
      if (recursive && touchesSystemPath(args)) raise("critical", `recursive ${name} on a system path`);
      else if (/777/.test(flags + " " + args.join(" "))) raise("high", "makes files world-writable");
      else raise("high", `changes ${name === "chmod" ? "permissions" : "ownership"}`);
      continue;
    }

    if (name === "dd") { raise("critical", "dd writes blocks directly"); continue; }

    if (name === "docker" || name === "podman") {
      const sub = (rest.find(a => !a.startsWith("-")) || "").toLowerCase();
      const rest2 = rest.join(" ");
      if (sub === "system" && /prune/.test(rest2) && /-a|--all/.test(rest2)) raise("critical", "prunes every unused image and volume");
      else if (/volume\s+(rm|prune)/.test(rest2)) raise("critical", "removes a volume — the data in it goes too");
      else if (["rm", "kill", "down"].includes(sub) || /compose\s+down/.test(rest2)) raise("high", "removes or stops containers");
      else if (["stop", "restart", "pause", "update"].includes(sub)) raise("high", "stops or restarts a container");
      else if (["run", "start", "up", "pull", "build", "exec", "compose"].includes(sub)) raise("medium", "starts or fetches a container");
      else raise("low", "reads the container state");
      continue;
    }

    if (name === "systemctl" || name === "service") {
      const sub = (rest.find(a => !a.startsWith("-")) || "").toLowerCase();
      if (["mask", "disable"].includes(sub)) raise("critical", `${sub}s a service — it will not come back on boot`);
      else if (["stop", "restart", "reload", "kill"].includes(sub)) raise("high", `${sub}s a service`);
      else if (["start", "enable", "daemon-reload", "set-default"].includes(sub)) raise("medium", "changes what is running");
      else raise("low", "reads service state");
      continue;
    }

    if (name === "apt" || name === "apt-get" || name === "dpkg" || name === "snap") {
      const rest2 = rest.join(" ");
      if (/\b(purge|remove|autoremove|-r\b)/.test(rest2)) raise("high", "removes installed packages");
      else if (/\b(install|upgrade|dist-upgrade|full-upgrade)\b/.test(rest2)) raise("medium", "installs or upgrades packages");
      else raise("low", "reads the package lists");
      continue;
    }

    if (name === "git") {
      const sub = (rest.find(a => !a.startsWith("-")) || "").toLowerCase();
      if (["reset", "clean", "checkout", "restore", "rebase", "push"].includes(sub)) raise("high", `git ${sub} can discard work`);
      else if (["clone", "pull", "fetch", "commit", "add", "merge"].includes(sub)) raise("medium", "changes a working tree");
      else raise("low", "reads a repository");
      continue;
    }

    if (name === "find") {
      if (/-delete|-exec/.test(flags + " " + rest.join(" "))) raise("high", "find that deletes or executes");
      else raise("low", "searches the filesystem");
      continue;
    }

    if (name === "tee") {
      if (touchesSystemPath(args)) raise("high", "writes into a system path");
      else raise("medium", "writes a file");
      continue;
    }

    if (HIGH_CMDS.has(name)) { raise("high", `${name} changes the system`); continue; }
    if (MEDIUM_CMDS.has(name)) { raise("medium", `${name} changes something`); continue; }
    if (READ_ONLY.has(name)) { raise("low", null); continue; }

    raise("medium", `${name} is not a command this recogniser knows`);
  }

  // A redirect into a file is a write whatever the command was.
  if (/[^>|]>[^|&]/.test(cmd) && level === "low") raise("medium", "redirects output into a file");

  return {
    level,
    why: why.length ? why : ["reads state and changes nothing"],
    summary: `${level.toUpperCase()} — ${(why[0] || "reads state and changes nothing")}`
  };
}
