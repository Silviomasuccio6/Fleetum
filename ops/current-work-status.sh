#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

BRANCH="$(git branch --show-current)"
HEAD_SHA="$(git rev-parse --short=12 HEAD)"
HEAD_SUBJECT="$(git log -1 --pretty=%s)"
DIRTY_COUNT="$(git status --porcelain | wc -l | tr -d ' ')"
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

echo "Fleetum current work"
echo "- Branch: ${BRANCH:-detached HEAD}"
echo "- HEAD: ${HEAD_SHA} ${HEAD_SUBJECT}"
echo "- File modificati/non tracciati: ${DIRTY_COUNT}"

if [ -n "${UPSTREAM}" ]; then
  read -r BEHIND AHEAD < <(git rev-list --left-right --count "${UPSTREAM}...HEAD")
  echo "- Upstream: ${UPSTREAM} (ahead ${AHEAD}, behind ${BEHIND})"
else
  echo "- Upstream: non configurato"
fi

if [ "${1:-}" = "--remote" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "- Pull request: GitHub CLI non installata"
  elif ! gh auth status >/dev/null 2>&1; then
    echo "- Pull request: GitHub CLI non autenticata"
  else
    PR_SUMMARY="$(gh pr view --json number,url,state,isDraft,mergeable --jq '"#\(.number) \(.state) draft=\(.isDraft) mergeable=\(.mergeable) \(.url)"' 2>/dev/null || true)"
    echo "- Pull request: ${PR_SUMMARY:-nessuna PR associata al branch}"
  fi
fi
