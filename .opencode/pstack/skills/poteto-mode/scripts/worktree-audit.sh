#!/usr/bin/env bash
# Audit git worktrees without changing refs or inferring chat activity.
set -euo pipefail

base=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -b|--base) [ "$#" -ge 2 ] || { echo "missing base ref" >&2; exit 2; }; base="$2"; shift 2 ;;
    -h|--help) echo 'Usage: worktree-audit.sh [-b <base-ref>] [repo-path]'; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
repo="${1:-.}"
git -C "$repo" rev-parse --git-dir >/dev/null
if [ -z "$base" ]; then
  for candidate in origin/HEAD origin/main origin/master main master; do
    if git -C "$repo" rev-parse --verify --quiet "$candidate^{commit}" >/dev/null; then
      base="$candidate"
      break
    fi
  done
fi
[ -n "$base" ] || { echo 'No base ref; pass -b <ref>.' >&2; exit 1; }
git -C "$repo" rev-parse --verify "$base^{commit}" >/dev/null
printf '# base: %s (local refs, no fetch)\n' "$base"
printf 'SIZE\tMERGED\tDIRTY\tLAST_CHAT\tBUCKET\tWORKTREE\n'
first=true
while IFS= read -r -d '' field; do
  case "$field" in
    'worktree '*)
      wt="${field#worktree }"
      if "$first"; then first=false; continue; fi
      if [ ! -d "$wt" ]; then
        printf '?\t?\t?\tunavailable\treview-missing\t%s\n' "$wt"
        continue
      fi
      size=$(du -sh -- "$wt" 2>/dev/null | cut -f1) || size='?'
      merged=no
      if git -C "$wt" merge-base --is-ancestor HEAD "$base"; then merged=yes; fi
      dirty=clean
      if [ -n "$(git -C "$wt" status --porcelain)" ]; then dirty=dirty; fi
      bucket=review-history-unavailable
      if [ "$dirty" = dirty ]; then bucket=hold-dirty; fi
      printf '%s\t%s\t%s\tunavailable\t%s\t%s\n' "$size" "$merged" "$dirty" "$bucket" "$wt"
      ;;
  esac
done < <(git -C "$repo" worktree list --porcelain -z)
