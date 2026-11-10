#!/usr/bin/env bash
# Set up Claude Code for the Nexus "Claude Code" button.
#
# Run it as YOUR user, not root:   bash ~/nexus/scripts/claude-setup.sh
#
# It is safe to run again. It never overwrites anything you have written:
#   - installs Claude Code if it is missing (asks first)
#   - puts ~/.local/bin on your PATH if it is not
#   - installs tmux if it is missing (asks for your sudo password)
#   - adds the house rules to ~/.claude/CLAUDE.md (only if you have none)
#   - adds read-only commands to the allow-list in ~/.claude/settings.json
#     (merged into yours, with a backup)
#   - makes ~/.trash, where the rules tell Claude to move things instead of deleting
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/claude"
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
note() { printf '  \033[33m•\033[0m %s\n' "$*"; }
ask()  { local a; read -r -p "  $1 [Y/n] " a || true; [[ -z "$a" || "$a" =~ ^[Yy] ]]; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root (no sudo):"
  echo "  bash $HERE/claude-setup.sh"
  echo "Claude Code is installed per user; the Nexus button runs it as that user."
  exit 1
fi
[[ -f "$SRC/CLAUDE.md" && -f "$SRC/settings.json" ]] || { echo "Missing $SRC — run this from the Nexus checkout."; exit 1; }

echo
echo "Claude Code for $(whoami) on $(hostname)"
echo

# 1. Claude Code itself
BIN=""
for p in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" "$(command -v claude 2>/dev/null || true)"; do
  [[ -n "$p" && -x "$p" ]] && { BIN="$p"; break; }
done
if [[ -z "$BIN" ]]; then
  if ask "Claude Code is not installed. Install it now?"; then
    curl -fsSL https://claude.ai/install.sh | bash
    BIN="$HOME/.local/bin/claude"
    [[ -x "$BIN" ]] || BIN="$(command -v claude 2>/dev/null || true)"
  fi
fi
[[ -n "$BIN" && -x "$BIN" ]] && ok "Claude Code: $BIN" || note "Claude Code is not installed — run: curl -fsSL https://claude.ai/install.sh | bash"

# 2. ~/.local/bin on PATH, for logins from now on
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]] && ! grep -qs 'HOME/.local/bin' "$HOME/.bashrc"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  ok "added ~/.local/bin to your PATH in ~/.bashrc (open a new terminal, or: source ~/.bashrc)"
else
  ok "~/.local/bin is on your PATH"
fi

# 3. tmux, so a session outlives the browser tab
if command -v tmux >/dev/null 2>&1; then
  ok "tmux: $(tmux -V)"
elif ask "tmux is not installed (it keeps Claude running when you close the tab). Install it?"; then
  sudo apt-get install -y tmux >/dev/null && ok "tmux installed"
else
  note "without tmux, closing the tab ends the Claude session"
fi

# 4. House rules
mkdir -p "$HOME/.claude"
if [[ ! -f "$HOME/.claude/CLAUDE.md" ]]; then
  cp "$SRC/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  ok "house rules written to ~/.claude/CLAUDE.md — edit them to taste"
elif cmp -s "$SRC/CLAUDE.md" "$HOME/.claude/CLAUDE.md"; then
  ok "house rules already in place"
else
  cp "$SRC/CLAUDE.md" "$HOME/.claude/CLAUDE.nexus.md"
  note "you already have ~/.claude/CLAUDE.md, so it was left alone; Nexus's version is in ~/.claude/CLAUDE.nexus.md to compare"
fi

# 5. Allow-list: merge, never replace
SET="$HOME/.claude/settings.json"
if [[ ! -f "$SET" ]]; then
  cp "$SRC/settings.json" "$SET"
  ok "allow-list written to ~/.claude/settings.json"
elif command -v node >/dev/null 2>&1; then
  cp "$SET" "$SET.bak-$(date +%Y%m%d-%H%M%S)"
  node -e '
    const fs = require("fs");
    const [mine, ours] = process.argv.slice(1).map(f => JSON.parse(fs.readFileSync(f, "utf8")));
    mine.permissions = mine.permissions || {};
    const before = (mine.permissions.allow || []).length;
    mine.permissions.allow = [...new Set([...(mine.permissions.allow || []), ...ours.permissions.allow])];
    fs.writeFileSync(process.argv[1], JSON.stringify(mine, null, 2) + "\n");
    console.log("  \x1b[32m✓\x1b[0m allow-list merged into ~/.claude/settings.json (" + (mine.permissions.allow.length - before) + " added, backup kept)");
  ' "$SET" "$SRC/settings.json"
else
  cp "$SRC/settings.json" "$HOME/.claude/settings.nexus.json"
  note "node not found to merge settings; Nexus's allow-list is in ~/.claude/settings.nexus.json"
fi

# 6. The trash the rules point at
mkdir -p "$HOME/.trash" && ok "~/.trash is ready"

echo
echo "Next:"
if [[ -n "$BIN" && ! -f "$HOME/.claude/.credentials.json" && ! -f "$HOME/.claude.json" ]]; then
  echo "  1. Run:  $BIN"
  echo "     and sign in with your Claude account (Pro or Max — not an API key)."
  echo "  2. In Nexus, press Claude Code in the sidebar."
else
  echo "  In Nexus, press Claude Code in the sidebar. If it asks you to sign in, run \"claude\" once here first."
fi
echo
