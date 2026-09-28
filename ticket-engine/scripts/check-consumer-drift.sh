#!/usr/bin/env bash
# Fail when a consumer's installed @omni/ticket-engine copy has drifted from
# this package's dist/.
#
# Why this exists: consumers install via `file:` (a copied directory, not a
# symlink), and their test runners alias/resolve the SOURCE while apps bundle
# the node_modules copy. A stale copy therefore ships unfixed engine code with
# every test green — this check is the only thing that catches it.
#
# Run: yarn check:drift   (from packages/ticket-engine)
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
status=0

for consumer in "$HERE/../../frontend" "$HERE/../../rolonative"; do
  copy="$consumer/node_modules/@omni/ticket-engine/dist"
  if [ ! -d "$copy" ]; then
    echo "check:drift skip (not installed): $copy"
    continue
  fi
  if ! diff -rq "$HERE/dist" "$copy" >/dev/null 2>&1; then
    echo "check:drift DRIFT: $copy differs from packages/ticket-engine/dist"
    diff -rq "$HERE/dist" "$copy" 2>&1 | sed 's/^/  /'
    echo "  fix: yarn build in packages/ticket-engine, then rm -rf the copy above and yarn install in the consumer"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "check:drift OK: consumer engine copies match packages/ticket-engine/dist"
fi
exit "$status"
