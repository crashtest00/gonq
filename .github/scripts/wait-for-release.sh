#!/bin/sh
# Waits for the GitHub Release of $TAG (created by release-desktop.yml) and attaches $ASSET to it (M-32).
# Never creates a Release and never edits its title or notes. Used only by release-mobile.yml.
# Env: TAG, ASSET (file to upload), REPO (optional, passed to gh --repo), GH_TOKEN.
#   POLL_SECONDS (default 60) and MAX_WAIT_MINUTES (default 120) bound the wait.
#   DRY_RUN=1: read-only `gh release view` only, no upload, and ASSET need not exist.
#   DRY_RUN=1 MAX_WAIT_MINUTES=0 checks once without waiting.
set -eu

: "${TAG:?TAG is required}"
POLL_SECONDS="${POLL_SECONDS:-60}"
MAX_WAIT_MINUTES="${MAX_WAIT_MINUTES:-120}"
DRY_RUN="${DRY_RUN:-}"
repo_args=""
[ -n "${REPO:-}" ] && repo_args="--repo ${REPO}"

if [ -z "$DRY_RUN" ]; then
  : "${ASSET:?ASSET is required}"
  [ -f "$ASSET" ] || { echo "::error::$ASSET not found"; exit 1; }
fi

deadline=$(( $(date +%s) + MAX_WAIT_MINUTES * 60 ))
while :; do
  # shellcheck disable=SC2086
  if gh release view "$TAG" $repo_args > /dev/null 2>&1; then
    echo "GitHub Release $TAG exists."
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::no GitHub Release for $TAG after ${MAX_WAIT_MINUTES} min; APK kept as artifact."
    exit 1
  fi
  echo "No Release for $TAG yet; checking again in ${POLL_SECONDS}s."
  sleep "$POLL_SECONDS"
done

if [ -n "$DRY_RUN" ]; then
  echo "DRY_RUN: would run: gh release upload $TAG ${ASSET:-<asset>} --clobber"
  exit 0
fi
# shellcheck disable=SC2086
gh release upload "$TAG" "$ASSET" $repo_args --clobber
echo "Attached $ASSET to $TAG."
