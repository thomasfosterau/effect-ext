#!/usr/bin/env bash
# Opens an issue for every open Dependabot PR whose head commit fails CI, keeps
# it current while the PR keeps failing, and closes it once the PR passes,
# merges or closes. Run by .github/workflows/dependabot-failures.yml on a
# schedule; run it locally with `--dry-run` to print the actions it would take
# without writing anything.
#
#   .github/scripts/dependabot-failures.sh [--dry-run] [--repo owner/name]
#
# Reads only REST endpoints (`gh api`), never GraphQL, so it runs the same in
# Actions and in a session whose proxy blocks GraphQL. It never checks out or
# runs PR code: it reads check runs and commit statuses by SHA. PR titles and
# check names reach GitHub only as JSON built by `jq --arg`, never through a
# shell expansion.
#
# Idempotent: a run where nothing changed makes no write. An issue's body
# carries `<!-- dependabot-pr:<n> -->` (which PR it tracks) and
# `<!-- dependabot-failure-state:<sha> <failing checks> -->` (what it last
# reported); the body is rewritten only when that state changes.
set -euo pipefail

LABEL="dependabot-failure"
SELF_CHECK="dependabot-failures" # this workflow's job name
dry_run=false
repo="${GITHUB_REPOSITORY:-}"

while (($#)); do
  case "$1" in
    --dry-run) dry_run=true ;;
    --repo)
      repo="${2:?--repo needs owner/name}"
      shift
      ;;
    *)
      echo "usage: $0 [--dry-run] [--repo owner/name]" >&2
      exit 2
      ;;
  esac
  shift
done
[[ -n "$repo" ]] || {
  echo "no repository: pass --repo or set GITHUB_REPOSITORY" >&2
  exit 2
}

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
log() {
  printf '%s\n' "$1"
  printf -- '- %s\n' "$1" >>"$summary"
}

# write <description> <gh api args...>: performs the call, or prints it on --dry-run.
write() {
  local what="$1"
  shift
  if $dry_run; then
    # Drain a piped request body, or its writer dies of SIGPIPE under pipefail.
    [[ " $* " != *" --input - "* ]] || cat >/dev/null
    printf '  [dry-run] would %s\n' "$what"
  else
    gh api "$@" >/dev/null
  fi
}

ensure_label() {
  if gh api "repos/$repo/labels/$LABEL" >/dev/null 2>&1; then return; fi
  if $dry_run; then
    printf '  [dry-run] would create label %s\n' "$LABEL"
  else
    gh label create "$LABEL" -R "$repo" --color B60205 \
      --description "A Dependabot PR is failing CI" --force >/dev/null
  fi
}

comment() { # comment <issue> <text>
  jq -n --arg body "$2" '{body: $body}' |
    write "comment on #$1: $2" -X POST "repos/$repo/issues/$1/comments" --input -
}

close_issue() { # close_issue <issue> <completed|not_planned> <comment>
  comment "$1" "$3"
  write "close #$1 as $2" -X PATCH "repos/$repo/issues/$1" \
    -f state=closed -f state_reason="$2"
}

# Classify a commit: prints one JSON object {verdict, failing: [{name, conclusion, url}]}.
classify() {
  local sha="$1" runs statuses
  runs="$(gh api --paginate "repos/$repo/commits/$sha/check-runs?per_page=100" \
    --jq '.check_runs[]' | jq -s --arg self "$SELF_CHECK" '
      map(select(.name != $self and .app.slug != "dependabot" and (.name | test("^Dependabot\\b") | not)))
      | map({name, status, conclusion, url: (.details_url // .html_url)})')"
  # The combined-status endpoint already keeps only the latest status per context.
  statuses="$(gh api "repos/$repo/commits/$sha/status" \
    --jq '[.statuses[] | {name: .context, state, url: .target_url}]')"
  jq -n --argjson runs "$runs" --argjson statuses "$statuses" '
    ($runs | map(select(.status == "completed" and
        (.conclusion | IN("failure", "timed_out", "action_required", "startup_failure"))))
      | map({name, conclusion, url})) as $failedRuns
    | ($statuses | map(select(.state | IN("failure", "error")))
      | map({name, conclusion: .state, url})) as $failedStatuses
    | ($failedRuns + $failedStatuses | sort_by(.name)) as $failing
    | if ($failing | length) > 0 then {verdict: "failing", failing: $failing}
      elif (($runs | length) + ($statuses | length)) > 0
        and ($runs | all(.status == "completed" and (.conclusion | IN("success", "neutral", "skipped"))))
        and ($statuses | all(.state == "success"))
      then {verdict: "passing", failing: []}
      else {verdict: "pending", failing: []} end'
}

render_body() { # render_body <pr-json> <sha> <failing-json> <state>
  jq -rn --argjson pr "$1" --arg sha "$2" --argjson failing "$3" --arg state "$4" '
    "Dependabot PR [#\($pr.number)](\($pr.html_url)) (\($pr.title)) fails CI at `\($sha)`.\n\n"
    + "| Check | Conclusion |\n| --- | --- |\n"
    + ($failing | map("| \(if .url then "[\(.name)](\(.url))" else .name end) | `\(.conclusion)` |") | join("\n"))
    + "\n\nThe `dependabot-failures` workflow updates this issue while the PR keeps failing, "
    + "and closes it automatically once the PR passes, merges or closes.\n\n"
    + "<!-- dependabot-pr:\($pr.number) -->\n<!-- dependabot-failure-state:\($state) -->"'
}

ensure_label

# Open tracking issues, keyed by the PR number in their marker.
issues="$(gh api --paginate "repos/$repo/issues?labels=$LABEL&state=open&per_page=100" --jq '.[]' |
  jq -s 'map(select(.pull_request == null)
    | {number, body: (.body // ""), pr: ((.body // "") | capture("<!-- dependabot-pr:(?<n>[0-9]+) -->").n? | tonumber?)})
    | map(select(.pr != null))')"

prs="$(gh api --paginate "repos/$repo/pulls?state=open&per_page=100" --jq '.[]' |
  jq -s 'map(select(.user.login == "dependabot[bot]") | {number, title, html_url, sha: .head.sha})')"

handled=()
# The loops read their list on fd 3, so nothing in their bodies can consume it.
while IFS= read -r -u 3 pr; do
  [[ -n "$pr" ]] || continue
  n="$(jq -r .number <<<"$pr")"
  sha="$(jq -r .sha <<<"$pr")"
  handled+=("$n")
  result="$(classify "$sha")"
  verdict="$(jq -r .verdict <<<"$result")"
  failing="$(jq -c .failing <<<"$result")"
  issue="$(jq -c --argjson n "$n" 'map(select(.pr == $n)) | first // empty' <<<"$issues")"
  issue_n=""
  [[ -z "$issue" ]] || issue_n="$(jq -r .number <<<"$issue")"
  detail=""
  [[ "$verdict" != failing ]] || detail=" — $(jq -r 'map(.name) | join(", ")' <<<"$failing")"
  log "PR #$n (${sha:0:7}): $verdict$detail${issue_n:+ — issue #$issue_n}"

  case "$verdict" in
    failing)
      state="$sha $(jq -r 'map("\(.name)=\(.conclusion)") | join(",")' <<<"$failing")"
      body="$(render_body "$pr" "$sha" "$failing" "$state")"
      if [[ -z "$issue_n" ]]; then
        title="Dependabot PR #$n fails CI: $(jq -r .title <<<"$pr")"
        jq -n --arg title "$title" --arg body "$body" --arg label "$LABEL" \
          '{title: $title, body: $body, labels: [$label]}' |
          write "open issue \"$title\"" -X POST "repos/$repo/issues" --input -
      elif ! jq -e --arg s "<!-- dependabot-failure-state:$state -->" '.body | contains($s)' <<<"$issue" >/dev/null; then
        jq -n --arg body "$body" '{body: $body}' |
          write "update #$issue_n (SHA or failing checks changed)" -X PATCH "repos/$repo/issues/$issue_n" --input -
      fi
      ;;
    passing)
      if [[ -n "$issue_n" ]]; then
        close_issue "$issue_n" completed "PR #$n now passes CI at \`$sha\`."
      fi
      ;;
  esac
done 3< <(jq -c '.[]' <<<"$prs")

# Issues whose PR is no longer open.
while IFS= read -r -u 3 issue; do
  [[ -n "$issue" ]] || continue
  issue_n="$(jq -r .number <<<"$issue")"
  n="$(jq -r .pr <<<"$issue")"
  [[ " ${handled[*]} " == *" $n "* ]] && continue
  merged="$(gh api "repos/$repo/pulls/$n" --jq '.merged_at != null')"
  if [[ "$merged" == true ]]; then
    log "PR #$n merged — closing issue #$issue_n"
    close_issue "$issue_n" completed "PR #$n was merged."
  else
    log "PR #$n closed unmerged — closing issue #$issue_n"
    close_issue "$issue_n" not_planned "PR #$n was closed without merging (usually superseded by a newer Dependabot PR)."
  fi
done 3< <(jq -c '.[]' <<<"$issues")

[[ ${#handled[@]} -gt 0 ]] || log "No open Dependabot PRs."
