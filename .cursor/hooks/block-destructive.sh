#!/bin/bash
# Cursor `beforeShellExecution` hook — refuses to run any command that
# matches a known data-loss pattern (see .cursor/rules/destructive-operations.mdc).
#
# This is the agent-level last line of defence. Even if the agent forgets
# the rule, the command literally cannot run from inside Cursor.
#
# Failure mode is "block": if jq is missing, the JSON is malformed, or this
# script crashes for any reason, the hook is configured with failClosed:true
# in hooks.json so the command is denied until a human intervenes.
#
# To run a denied command on purpose (rare, requires very deliberate human
# review), set the env var DELIVERY_OPS_ALLOW_DESTRUCTIVE=I_REALLY_MEAN_IT
# in YOUR shell BEFORE invoking Cursor. The hook will pass through with a
# loud warning.

set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.command // empty')

# Empty / non-string → defer to other gates.
if [ -z "$command" ]; then
  printf '{"permission":"allow"}\n'
  exit 0
fi

# ─── The blocklist ────────────────────────────────────────────────────────
# Each entry is a regex evaluated case-insensitively against the full command.
# Order doesn't matter — the first match wins.
#
# Sources of truth: .cursor/rules/destructive-operations.mdc + the
# 2026-05-11 + 2026-05-15 incident retrospectives.

PATTERNS=(
  # Supabase
  '\bsupabase\s+db\s+reset\b'
  '\bsupabase\s+stop\s+(--no-backup|.*\s--no-backup)\b'

  # Raw SQL destruction
  '\bdrop\s+(table|schema|database|index|column|view|materialized\s+view|tablespace|publication|subscription)\b'
  '\btruncate(\s+table)?\b'
  '\bdelete\s+from\s+\w+\s*(;|$)'    # DELETE FROM table with no WHERE — ALWAYS suspect

  # Filesystem destruction of stateful directories
  '\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s|-rf?\s).*\bsupabase\b'
  '\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s|-rf?\s).*\.env'
  '\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s|-rf?\s)/$'  # rm -rf /

  # Docker volume destruction (the supabase volumes carry the DB)
  '\bdocker\s+volume\s+(rm|prune)'

  # Git destruction
  '\bgit\s+reset\s+--hard\b'
  '\bgit\s+clean\s+(-[a-zA-Z]*[fdx][a-zA-Z]*\s|-fd?x?\s)'
  '\bgit\s+push\s+(--force|.*\s--force|-f\s|.*\s-f\s|.*\s\+)'  # force push

  # The "|| destructive-fallback" pattern that caused 2026-05-11
  '\|\|\s*(supabase\s+db\s+reset|drop\s+|truncate\s+|rm\s+-rf?\s)'
)

# Allow-by-prefix list — read-only / planning operations involving the same
# verbs. These are checked FIRST so e.g. `rm --help` doesn't trip the rules.
# Patterns are passed via `grep -e` so leading dashes don't confuse BSD grep.
ALLOW_PATTERNS=(
  '^[[:space:]]*supabase[[:space:]]+(start|status|migration|gen|link|inspect)\b'
  '\bsafe-migrate\.ts\b'
  '\bdb-snapshot\.ts\b'
  '[[:space:]]-(-dry|-dry-run)\b'
  '\bgrep\b|\brg\b|\bripgrep\b'      # searching FOR these patterns is fine
)

# Hard escape hatch for emergencies — must be set in the user's shell BEFORE
# launching Cursor. Loudly warns rather than silently passing.
if [ "${DELIVERY_OPS_ALLOW_DESTRUCTIVE:-}" = "I_REALLY_MEAN_IT" ]; then
  printf '{"permission":"allow","agent_message":"⚠ DELIVERY_OPS_ALLOW_DESTRUCTIVE escape hatch is ACTIVE. Destructive commands are NOT being blocked this session. Unset the env var before resuming normal work."}\n'
  exit 0
fi

# ─── Match ────────────────────────────────────────────────────────────────

# Allow-list short-circuit. `grep -e` so patterns starting with `-` don't
# get parsed as flags by BSD grep on macOS.
for pattern in "${ALLOW_PATTERNS[@]}"; do
  if printf '%s' "$command" | grep -qiE -e "$pattern"; then
    printf '{"permission":"allow"}\n'
    exit 0
  fi
done

# Blocklist scan.
for pattern in "${PATTERNS[@]}"; do
  if printf '%s' "$command" | grep -qiE -e "$pattern"; then
    matched_pattern=$pattern
    block_msg="DeliveryOps destructive-ops guard: this command matches the data-loss blocklist (pattern: ${matched_pattern}). It cannot run from inside Cursor.

If this is a deliberate, reviewed action that you (the human) want to run anyway:
  1. Read .cursor/rules/destructive-operations.mdc and docs/RUNBOOK.md.
  2. Take a snapshot first: npx tsx scripts/db-snapshot.ts
  3. Run the command yourself in a terminal Cursor doesn't control.

The agent must not bypass this guard."

    user_msg="Cursor blocked a potentially destructive command:
  $command

Reason: matches the destructive-ops blocklist (.cursor/rules/destructive-operations.mdc).
Pattern: ${matched_pattern}

If you actually want this run, do it yourself in a terminal Cursor doesn't control. Don't ask the agent to bypass."

    # jq -n -c builds a compact, escape-safe JSON object.
    jq -n -c \
      --arg user "$user_msg" \
      --arg agent "$block_msg" \
      '{permission:"deny", user_message:$user, agent_message:$agent}'
    exit 0
  fi
done

# No match → allow.
printf '{"permission":"allow"}\n'
exit 0
