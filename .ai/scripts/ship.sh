#!/usr/bin/env bash
# Ship uncommitted changes as a pull request against main. It does the git/gh
# mechanics the same way for every AI tool (and for humans); deciding *what*
# to ship and *what to say* is the pr-manager agent's job.
#
#   .ai/scripts/ship.sh --branch feat/short-slug \
#       --message-file <file>   # commit message; first line becomes the PR title
#       --body-file <file>      # PR description (markdown)
#       [--draft] [--base main]
#       -- <path> [<path>...]   # exactly what to commit (no `git add -A`)
#
# Steps: preflight → new branch from origin/<base> carrying the changes →
# verify.sh → stage the listed paths → secret scan → commit → push → gh pr create.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

die() { echo "ship: $*" >&2; exit 1; }
step() { echo "==> $*"; }

BRANCH="" MSG_FILE="" BODY_FILE="" BASE="main" DRAFT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --message-file) MSG_FILE="$2"; shift 2 ;;
    --body-file) BODY_FILE="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --draft) DRAFT=(--draft); shift ;;
    --) shift; break ;;
    *) die "unknown argument: $1 (paths go after --)" ;;
  esac
done
PATHS=("$@")

# ---- preflight -------------------------------------------------------------
[ -n "$BRANCH" ] || die "--branch is required (e.g. feat/pr-agent)"
[[ "$BRANCH" =~ ^(feat|fix|refactor|chore|docs|test|perf|ci)/[a-z0-9._-]+$ ]] \
  || die "branch '$BRANCH' must look like <feat|fix|refactor|chore|docs|test|perf|ci>/<kebab-slug>"
[ -s "$MSG_FILE" ] || die "--message-file is missing or empty"
[ -s "$BODY_FILE" ] || die "--body-file is missing or empty"
[ ${#PATHS[@]} -gt 0 ] || die "list the paths to commit after --"
TITLE="$(head -1 "$MSG_FILE")"
[[ "$TITLE" =~ ^(feat|fix|refactor|chore|docs|test|perf|ci)(\([a-z0-9-]+\))?!?:\ .+ ]] \
  || die "commit subject must be conventional (e.g. 'feat: add PR agent'), got: $TITLE"
[ ${#TITLE} -le 72 ] || die "commit subject is ${#TITLE} chars; keep it to 72"

command -v gh >/dev/null || die "GitHub CLI not installed (brew install gh)"
gh auth status >/dev/null 2>&1 || die "gh is not logged in: run 'gh auth login'"
git remote get-url origin >/dev/null 2>&1 || die "no 'origin' remote"

for p in "${PATHS[@]}"; do
  case "$p" in
    server/config/profile.yaml|server/data|server/data/*|*.env|.env*|*/.env*)
      die "refusing to commit personal data / secrets: $p" ;;
  esac
done
if [ -z "$(git status --porcelain -- "${PATHS[@]}")" ]; then
  die "nothing to commit in the listed paths"
fi

# ---- branch from origin/<base>, carrying the working-tree changes ----------
step "Fetching origin/$BASE"
git fetch --quiet origin "$BASE"

CURRENT="$(git branch --show-current)"
if [ "$CURRENT" != "$BRANCH" ]; then
  git show-ref --verify --quiet "refs/heads/$BRANCH" && die "local branch $BRANCH already exists; pick another name"
  git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1 && die "origin/$BRANCH already exists; pick another name"

  ahead="$(git rev-list --count "origin/$BASE..HEAD")"
  if [ "$ahead" -gt 0 ]; then
    echo "warning: $CURRENT has $ahead commit(s) not on origin/$BASE; they will NOT be in this PR:" >&2
    git log --oneline "origin/$BASE..HEAD" >&2
  fi

  step "Creating $BRANCH from origin/$BASE"
  if ! git switch --quiet --no-track -c "$BRANCH" "origin/$BASE" 2>/dev/null; then
    # The working tree conflicts with the base: move the changes across via a stash.
    git stash push --quiet --include-untracked -m "ship:$BRANCH" -- "${PATHS[@]}"
    git switch --quiet --no-track -c "$BRANCH" "origin/$BASE" \
      || die "could not switch to $BRANCH (other uncommitted files conflict with origin/$BASE). Your listed changes are in 'git stash list' as ship:$BRANCH."
    if ! git stash pop --quiet; then
      die "changes conflict with origin/$BASE. Resolve the conflicts on $BRANCH (your changes are also kept in 'git stash list'), then re-run."
    fi
  fi
fi

# ---- verify, stage, scan, commit -------------------------------------------
step "Running verify.sh"
"$ROOT/.ai/scripts/verify.sh" || die "verify.sh failed; fix it before shipping (the branch $BRANCH is left in place)"

step "Staging ${#PATHS[@]} path(s)"
git reset --quiet           # start from an empty index so only the listed paths go in
git add -- "${PATHS[@]}"
git diff --cached --name-status

staged="$(git diff --cached --name-only)"
if echo "$staged" | grep -qE '^server/(data/|config/profile\.yaml$)|(^|/)\.env'; then
  die "personal data or a .env file is staged; unstage it"
fi
if git diff --cached -U0 | grep -E '^\+' | grep -qE 'sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|gh[opsu]_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----'; then
  die "the staged diff looks like it contains an API key or private key; remove it"
fi

step "Committing"
git commit --quiet -F "$MSG_FILE"
git log --oneline -1

# ---- push + PR -------------------------------------------------------------
step "Pushing $BRANCH"
git push --quiet -u origin "$BRANCH"

step "Opening pull request"
url="$(gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" --body-file "$BODY_FILE" "${DRAFT[@]}")"
echo "PR: $url"
