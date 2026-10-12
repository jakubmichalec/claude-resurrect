#!/usr/bin/env bash
# Align the GitHub repository settings with what the workflows and rulesets
# expect. Idempotent; safe to re-run after changing a ruleset file or a topic.
#
#   bash scripts/github-repo-settings.sh
#
# Needs the GitHub CLI logged in as the repository owner. Everything is set
# through the REST API, including the rulesets from .github/rulesets and the
# CodeQL default setup.
set -euo pipefail

REPO="jakubmichalec/claude-resurrect"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULESETS_DIR="$ROOT/.github/rulesets"
EXTENSION_MANIFEST="$ROOT/packages/vscode/package.json"
HOMEPAGE="https://marketplace.visualstudio.com/items?itemName=jakubmichalec.claude-resurrect"
TOPICS='{"names":["claude-code","claude","vscode-extension","cursor","zed","terminal","session-restore"]}'

export GH_HOST=github.com GH_PAGER=cat

DESCRIPTION="$(node -p "require('$EXTENSION_MANIFEST').description")"

echo "== $REPO"

echo "-- features, merge options"
gh api -X PATCH "repos/$REPO" \
  -F has_wiki=false \
  -F has_projects=false \
  -F allow_merge_commit=false \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_update_branch=true \
  -F allow_auto_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  --jq '"   ok: \(.full_name)"'

echo "-- description, homepage, topics"
gh api -X PATCH "repos/$REPO" \
  -f description="$DESCRIPTION" \
  -f homepage="$HOMEPAGE" \
  --jq '"   ok: \(.homepage)"'
printf '%s' "$TOPICS" | gh api -X PUT "repos/$REPO/topics" --input - --jq '"   ok: \(.names | join(", "))"'

echo "-- rulesets from $RULESETS_DIR"
for file in "$RULESETS_DIR"/*.json; do
  name="$(node -p "require('$file').name")"
  existing_id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [ -n "$existing_id" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$existing_id" --input "$file" --jq '"   ok: \(.name) updated (\(.enforcement))"'
  else
    gh api -X POST "repos/$REPO/rulesets" --input "$file" --jq '"   ok: \(.name) created (\(.enforcement))"'
  fi
done

echo "-- secret scanning + push protection"
printf '%s' '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}' \
  | gh api -X PATCH "repos/$REPO" --input - --jq '"   ok: \(.security_and_analysis.secret_scanning.status), push protection \(.security_and_analysis.secret_scanning_push_protection.status)"'

echo "-- dependabot alerts, security updates, private vulnerability reporting"
gh api -X PUT "repos/$REPO/vulnerability-alerts" && echo "   ok: alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes" && echo "   ok: security updates"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" && echo "   ok: private reporting"

echo "-- actions: GitHub-owned and verified creators only"
gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=selected && echo "   ok: selected"
gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" -F github_owned_allowed=true -F verified_allowed=true && echo "   ok: github-owned + verified"

echo "-- CodeQL default setup"
if [ "$(gh api "repos/$REPO/code-scanning/default-setup" --jq .state)" = "configured" ]; then
  echo "   ok: already configured"
else
  printf '%s' '{"state":"configured","query_suite":"default","languages":["javascript-typescript"]}' \
    | gh api -X PATCH "repos/$REPO/code-scanning/default-setup" --input - >/dev/null && echo "   ok: configured"
fi

echo "-- result"
gh api "repos/$REPO" --jq '"   wiki=\(.has_wiki) projects=\(.has_projects) merge_commit=\(.allow_merge_commit) delete_branch=\(.delete_branch_on_merge) auto_merge=\(.allow_auto_merge) update_branch=\(.allow_update_branch) topics=\(.topics|length)\n   secret_scanning=\(.security_and_analysis.secret_scanning.status) push_protection=\(.security_and_analysis.secret_scanning_push_protection.status) dependabot_security_updates=\(.security_and_analysis.dependabot_security_updates.status)"'
echo "   private_vuln_reporting=$(gh api "repos/$REPO/private-vulnerability-reporting" --jq '.enabled') allowed_actions=$(gh api "repos/$REPO/actions/permissions" --jq '.allowed_actions') codeql=$(gh api "repos/$REPO/code-scanning/default-setup" --jq '.state')"
echo "   rulesets: $(gh api "repos/$REPO/rulesets" --jq '[.[] | "\(.name) (\(.enforcement))"] | join(", ")')"
