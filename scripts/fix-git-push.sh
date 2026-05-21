#!/usr/bin/env bash
# Run this from the Replit Shell tab to fix the stale git lock + push rejection.
# Usage: bash scripts/fix-git-push.sh

set -e

echo "=== Step 1: Remove stale git lock file ==="
LOCK="/home/runner/workspace/.git/refs/remotes/origin/HEAD.lock"
if [ -f "$LOCK" ]; then
  rm -f "$LOCK"
  echo "✓ Removed $LOCK"
else
  echo "✓ No lock file found (already clean)"
fi

echo ""
echo "=== Step 2: Fetch remote state ==="
git fetch origin

echo ""
echo "=== Step 3: Check divergence ==="
AHEAD=$(git rev-list --count origin/main..HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main)
echo "Local is $AHEAD ahead, $BEHIND behind origin/main"

if [ "$BEHIND" -gt 0 ]; then
  echo ""
  echo "=== Step 4: Rebase onto remote ==="
  git rebase origin/main
  echo "✓ Rebase complete"
fi

echo ""
echo "=== Step 5: Push ==="
git push origin main
echo "✓ Push successful"
