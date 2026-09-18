/**
 * Does this peer address match one of the operator's trusted-proxy patterns?
 *
 * This used to be `remote.includes(pattern)`, which was wrong in both
 * directions: a CIDR like "172.18.0.0/16" never matched anything, so the
 * documented way to trust a Docker network silently did nothing; and
 * "10.0.0.1" matched the peer "110.0.0.1", so a pattern could trust an
 * address nobody meant. Both matter — this list decides whether
 * X-Forwarded-Proto and X-Forwarded-Host are believed.
 *
 * Accepted patterns:
 *   192.168.1.50        one address
 *   172.18.0.0/16       a CIDR block
 *   192.168.             a dotted prefix (kept: it is what people already wrote)
 *   ::1, localhost      the loopbacks, either family
 */

/** Node reports IPv4 peers over a dual-stack socket as ::ffff:a.b.c.d. */
function normalise(addr) {
  const a = String(addr || "").trim().toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  return m ? m[1] : a;
}

const v4 = a => /^\d{1,3}(\.\d{1,3}){3}$/.test(a);

function toInt(a) {
  const p = a.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function peerMatches(remote, pattern) {
  const addr = normalise(remote);
  const pat = String(pattern || "").trim().toLowerCase();
  if (!addr || !pat) return false;

  if (pat === "localhost") return addr === "127.0.0.1" || addr === "::1";
  if (addr === pat) return true;

  // CIDR
  const slash = pat.indexOf("/");
  if (slash > 0) {
    const base = pat.slice(0, slash);
    const bits = Number(pat.slice(slash + 1));
    if (!v4(base) || !v4(addr) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const a = toInt(addr), b = toInt(base);
    if (a === null || b === null) return false;
    // A /0 shift by 32 is undefined in JS, so spell that case out.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }

  // A dotted prefix, which is what the substring form was really being used for.
  // Anchored at the start, so "10.0.0." cannot match "110.0.0.7".
  if (pat.endsWith(".")) return addr.startsWith(pat);

  return false;
}

/** True when the peer matches any pattern in the list. */
export const peerInList = (remote, list) =>
  Array.isArray(list) && list.some(p => peerMatches(remote, p));
