// Jenkinsfile.template
//
// Canonical per-project Jenkinsfile. Copy into a project's repo root, set
// PROJECT_NAME below, and fill in the four TODO blocks with that project's
// actual install/test/build/deploy commands (see docs/ClaudeInstructions.md
// Phase 2, and the DevOps handbook — a dispatched DevOps session reads its
// own snapshot copy of that, at the path its dispatch context gives, not a
// `setup/` directory relative to this file).
//
// Implements the per-story flow as TWO builds of this one file. A single build
// can't do it all: the PR build IS the required status check that unlocks
// the merge, and GitHub only performs that merge after the build has posted
// its final status -- i.e. after the build has ended. So anything that must
// happen *after* the merge (promote to beta, deploy, evidence, In Review)
// has to live in the build the merge itself triggers:
//
//   1. PR build  (BRANCH_NAME = PR-N, CHANGE_ID set)
//      Install -> Test -> Build (beside the Rust checks, in parallel), then
//      records the tested tree and runs `gh pr merge --auto`. GitHub squash-
//      merges the PR into `dev` once this build reports success. Nothing
//      beta- or review-status-related happens here. The work item stays In
//      Progress.
//
//   2. dev build (BRANCH_NAME = dev), triggered by the push that merge makes
//      Install -> Test -> Build again on the merged tip (the only build that
//      ever sees the real post-merge `dev`) -- skipped when the PR build
//      already tested this exact tree (`gonq/tested-tree`, see Resolve) --
//      then fast-forward `beta` to exactly this commit, deploy it to the Beta VM, and publish ONE
//      canonical `beta_deployed` event naming the pull requests that landed
//      since `beta` was last promoted. The platform decides what follows
//      from it -- the evidence comment and the move into review are made by
//      the core service, not here.
//
// This pipeline identifies work by **pull request**, never by a tracker key.
// GitHub's own commit -> pull-request association gives the merged PR for
// each first-parent commit `beta` does not have yet, and its `html_url` is
// the reference the platform resolves (V5.2 Canonical Delivery State REQ-01,
// REQ-02); an agent records the same url when it opens the PR, which is what
// makes it resolvable. `origin/beta..dev` is the unit of work, so nothing is
// skipped or double-counted, and a promoted commit with no merged PR is
// carried as its SHA and resolves to nothing, which the platform records
// rather than drops.
//
// On failure of either build, Jenkins publishes one `pipeline_retry` message
// naming the same pull requests, to ScrumMaster, over the same durable
// gateway Streams transport agents use, through the raw file/stdin entry
// point of the commons publish tool -- the entry point for a producer that
// already holds a message, which is Jenkins' case; an agent names an
// operation and its fields to a2a-submit.js instead. The tool validates the
// payload before it writes, so a malformed message fails this step rather
// than being dropped server-side (Streams-based delivery only -- no
// PUBLISH/SUBSCRIBE/PSUBSCRIBE in normal operation). It names no agent and
// no ticket: the platform resolves each pull request to a work item, appends
// the failure comment itself, and asks ScrumMaster to redispatch that work
// item's recorded owner.
//
// Release preview and production promotion are NOT handled here -- they're
// separate, centrally-defined Jenkins jobs (release-candidate,
// production-promote, release-preview-teardown; see jenkins/jenkins.yaml)
// triggered by ScrumMaster from a Release work item's own canonical state.
//
// GitHub prerequisites (setup/JenkinsConfig.md §7): "Allow auto-merge" on
// the repo; `dev` requires the status check `continuous-integration/jenkins/
// pr-merge` (the context a PR build posts) with "require branches to be up
// to date" OFF -- with it on, the second of two queued PRs can never
// auto-merge after the first lands, because nothing updates its branch.

pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    // One dev build at a time: two of them racing on the beta push / status
    // transitions would be the same problem this split exists to avoid.
    disableConcurrentBuilds()
  }

  environment {
    // TODO: set to this project's name -- matches the PROJECT_NAME
    // convention used for the Beta URL below, the pipeline_retry gateway
    // stream, and config/projects.json's `name`.
    PROJECT_NAME = 'gonq'
  }

  stages {
    stage('Resolve') {
      // Work out what this build is for BEFORE testing, so a failure
      // anywhere below can still be attributed to the right ticket(s).
      steps {
        script {
          if (env.CHANGE_ID) {
            env.PIPELINE_KIND = 'pr'
            // A PR build carries its own pull request. CHANGE_URL is the
            // multibranch plugin's own url for it, the same identifier the
            // dev build takes from GitHub's commit -> PR association, so
            // both builds name work the same way.
            env.PROMOTE_PRS = env.CHANGE_URL ?: ''
            // A PR build is the test gate: it always runs Install/Test/Build.
            env.RUN_TESTS = 'true'
            echo "PR #${env.CHANGE_ID}: ${env.CHANGE_BRANCH} -> ${env.CHANGE_TARGET}, ${env.PROMOTE_PRS ?: '(no PR url)'}"
          } else if (env.BRANCH_NAME == 'dev') {
            env.PIPELINE_KIND = 'dev'
            // Multibranch checkouts fetch only their own branch, so bring in
            // beta explicitly. Credentials are needed for private repos.
            withCredentials([gitUsernamePassword(credentialsId: 'github-token', gitToolName: 'Default')]) {
              sh 'git fetch origin +refs/heads/beta:refs/remotes/origin/beta'
            }
            // Promote exactly the commit this build tested, not whatever
            // `dev` points at by the time we get to pushing.
            env.PROMOTE_SHA = env.GIT_COMMIT
            env.BETA_SHA = sh(returnStdout: true, script: 'git rev-parse origin/beta').trim()
            // Every first-parent commit beta doesn't have yet -> its merged
            // PR (GitHub associates squash *and* merge commits with the PR
            // that produced them) -> that PR's web url, which is the form
            // `gh pr create` prints, an agent passes as --pull-request, and
            // the platform resolves (V5.2 REQ-01: "The reference is the pull
            // request's web URL"). Deduplicated, space-separated.
            //
            // A commit with no merged PR, or whose lookup failed, is carried
            // as its own SHA: the platform resolves it to nothing and
            // records it as unresolved, which is strictly better than
            // dropping the commit from the event. Nothing here greps for a
            // tracker key -- that regex, and the key it found, are gone.
            env.PROMOTE_PRS = sh(returnStdout: true, script: '''
              for sha in $(git rev-list --first-parent --reverse "origin/beta..$PROMOTE_SHA"); do
                url=$(
                  gh api "repos/{owner}/{repo}/commits/$sha/pulls" \
                    --jq '.[] | select(.merged_at != null and .base.ref == "dev") | .html_url' \
                    2>/dev/null | head -1 \
                  || { echo "WARN: PR lookup failed for $sha, carrying its SHA instead" >&2; true; }
                )
                if [ -n "$url" ]; then echo "$url"; else echo "$sha"; fi
              done | awk '!seen[$0]++' | tr '\\n' ' '
            ''').trim()
            if (env.PROMOTE_SHA == env.BETA_SHA) {
              echo "beta is already at ${env.PROMOTE_SHA} -- nothing to promote"
            } else {
              echo "Promoting origin/beta..${env.PROMOTE_SHA} (pull requests: ${env.PROMOTE_PRS ?: '(none)'})"
            }

            // Skip the re-test when this exact tree was already tested.
            // The PR build tests Jenkins' local merge of the PR head with
            // dev, and records that merge's tree SHA as the `gonq/tested-tree`
            // status on the PR head (stage 'Record tested tree', below). When
            // dev has not moved between that build and the squash merge, the
            // squash commit's tree is byte-for-byte the tree already tested,
            // so Install/Test/Build here would re-test an identical tree.
            //
            // Skipped ONLY when all of these hold: exactly one merged PR into
            // dev for $PROMOTE_SHA; that PR head's latest `gonq/tested-tree`
            // is success with description == this commit's tree; its latest
            // `continuous-integration/jenkins/pr-merge` is success; and both
            // were posted by the same PR build (the pr-merge target_url
            // starts with the tested-tree target_url, which is that build's
            // BUILD_URL). Anything else -- mismatch, missing status, several
            // PRs, no PR, any API or git failure -- runs the full re-test.
            // The check itself never fails the build. Promote / deploy /
            // publish below are unchanged either way.
            env.SKIP_RETEST = 'false'
            def verdict = ''
            try {
              verdict = sh(returnStdout: true, script: '''
                set +e
                run() { echo "RUN: $*"; exit 0; }
                T=$(git rev-parse "$PROMOTE_SHA^{tree}" 2>/dev/null) || run "could not read the tree of $PROMOTE_SHA"
                [ -n "$T" ] || run "could not read the tree of $PROMOTE_SHA"
                PRS=$(gh api "repos/{owner}/{repo}/commits/$PROMOTE_SHA/pulls" \
                  --jq '.[] | select(.merged_at != null and .base.ref == "dev") | "\\(.number) \\(.head.sha)"' 2>&1) \
                  || run "PR lookup failed for $PROMOTE_SHA: $PRS"
                N=$(printf '%s\\n' "$PRS" | grep -c .)
                [ "$N" -eq 1 ] || run "$N merged PRs for $PROMOTE_SHA (need exactly 1)"
                PR=${PRS%% *}
                HEAD_SHA=${PRS#* }
                ST=$(gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/status" \
                  --jq '.statuses[] | select(.context == "gonq/tested-tree" or .context == "continuous-integration/jenkins/pr-merge") | [.context, .state, (.description // ""), (.target_url // "")] | @tsv' 2>&1) \
                  || run "status lookup failed for PR #$PR head $HEAD_SHA: $ST"
                TT=$(printf '%s\\n' "$ST" | awk -F '\\t' '$1 == "gonq/tested-tree"')
                PM=$(printf '%s\\n' "$ST" | awk -F '\\t' '$1 == "continuous-integration/jenkins/pr-merge"')
                [ -n "$TT" ] || run "no gonq/tested-tree status on PR #$PR head $HEAD_SHA"
                [ -n "$PM" ] || run "no pr-merge status on PR #$PR head $HEAD_SHA"
                TT_STATE=$(printf '%s' "$TT" | cut -f2); TT_TREE=$(printf '%s' "$TT" | cut -f3); TT_URL=$(printf '%s' "$TT" | cut -f4)
                PM_STATE=$(printf '%s' "$PM" | cut -f2); PM_URL=$(printf '%s' "$PM" | cut -f4)
                [ "$TT_STATE" = success ] || run "gonq/tested-tree on PR #$PR head is $TT_STATE"
                [ "$PM_STATE" = success ] || run "pr-merge on PR #$PR head is $PM_STATE"
                [ "$TT_TREE" = "$T" ] || run "tree mismatch: $PROMOTE_SHA has tree $T, PR #$PR build tested $TT_TREE"
                [ -n "$TT_URL" ] || run "gonq/tested-tree on PR #$PR head has no build url"
                case "$PM_URL" in
                  "$TT_URL"*) ;;
                  *) run "pr-merge ($PM_URL) and gonq/tested-tree ($TT_URL) came from different PR builds" ;;
                esac
                echo "SKIP re-test: tree $T tested by $TT_URL"
              ''').trim()
            } catch (err) {
              verdict = "RUN: tree check errored (${err})"
            }
            def lines = verdict.split('\n').findAll { it }
            verdict = lines ? lines[lines.size() - 1] : 'RUN: tree check printed nothing'
            if (verdict.startsWith('SKIP re-test: ')) {
              env.SKIP_RETEST = 'true'
              echo verdict
            } else {
              echo "Re-testing ${env.PROMOTE_SHA} in full -- ${verdict}"
            }
            env.RUN_TESTS = env.SKIP_RETEST == 'true' ? 'false' : 'true'
          } else {
            // beta / prod / release/<sha> / leftover merged branches: no
            // Install/Test/Build. Nothing downstream consumes this build's
            // outputs: beta only ever moves to a dev commit whose tree a dev
            // or PR build tested (stage 'Promote to beta and deploy');
            // release/<sha> is cut from beta's HEAD and prod is the squash of
            // that release PR (jenkins/jenkins.yaml release-candidate,
            // production-promote), which deploy the image the Beta VM already
            // built for that SHA or tag the SHA -- never this workspace's
            // build output -- and no branch protection requires this build's
            // `continuous-integration/jenkins/branch` status. The
            // release/<sha> -> prod PR still gets a full PR build.
            env.PIPELINE_KIND = 'other'
            env.RUN_TESTS = 'false'
            echo "SKIP: ${env.BRANCH_NAME} is not a PR or dev build -- Install/Test/Build not run " +
                 "(its tree was tested before it got here, and nothing reads this build's output)"
          }
        }
      }
    }

    // Install -> Test -> Build and the Rust checks run side by side. The
    // Rust checks are a GitHub-hosted run this build only dispatches and
    // waits on, so waiting in parallel holds the executor for the longer of
    // the two instead of their sum. Both branches run on this build's one
    // executor (the top-level `agent any`); failFast aborts the other branch
    // as soon as either fails, and either failure fails the build -- and so,
    // for a PR, its required status check.
    //
    // RUN_TESTS (set in Resolve) gates Install/Test/Build: true for every
    // PR build, true for a dev build unless its exact tree was already
    // tested (SKIP_RETEST), false for every other branch.
    stage('Verify') {
      failFast true
      parallel {
        stage('Install, test and build') {
          stages {
            stage('Install') {
              when { expression { env.RUN_TESTS == 'true' } }
              steps {
                sh 'npm ci'
              }
            }

            stage('Test') {
              when { expression { env.RUN_TESTS == 'true' } }
              steps {
                sh 'npm test'
              }
            }

            stage('Build') {
              when { expression { env.RUN_TESTS == 'true' } }
              steps {
                // Web build only; native Tauri builds run in GitHub Actions (build-desktop.yml).
                sh 'npm run build'
              }
            }
          }
        }

        // ---- PR build only -----------------------------------------------
        stage('Rust checks') {
          when { changeRequest target: 'dev' }
          options { timeout(time: 60, unit: 'MINUTES') }
          steps {
            // cargo test + clippy run on a GitHub-hosted runner (rust-checks.yml,
            // workflow_dispatch only), not on this agent. Dispatch it for the PR's
            // head commit, find the run by the correlation id embedded in its run
            // name, and wait: `gh run watch --exit-status` fails this stage -- and
            // so the PR build and its required status check -- when the run fails.
            //
            // Jenkins' checkout is a local merge commit GitHub has never seen, so
            // the SHA comes from the PR itself. gh needs a token with Actions:
            // write on the repo (the same one that dispatches build-desktop.yml).
            sh '''
              set -eu
              ERR=$(mktemp)
              # Only PRs that touch Rust code (crates/, apps/*/src-tauri/, root Cargo.toml, Cargo.lock)
              # need the Rust checks. Frontend-only PRs skip, loudly.
              if ! FILES=$(gh api --paginate "repos/{owner}/{repo}/pulls/$CHANGE_ID/files" --jq '.[] | .filename, (.previous_filename // empty)' 2>"$ERR"); then
                echo "ERROR: could not list the files changed by PR #$CHANGE_ID: $(cat "$ERR")" >&2
                exit 1
              fi
              if ! printf '%s\\n' "$FILES" | grep -qE '^(crates/|apps/[^/]+/src-tauri/|Cargo[.]toml$|Cargo[.]lock$)'; then
                echo "SKIP: PR #$CHANGE_ID changes no Rust files -- Rust checks (cargo test + clippy) not needed" >&2
                exit 0
              fi
              # Bootstrap only: until rust-checks.yml has landed on dev there is
              # nothing GitHub can dispatch by name. Only a confirmed 404 skips;
              # any other API failure (outage, auth) fails the build.
              if ! gh api "repos/{owner}/{repo}/contents/.github/workflows/rust-checks.yml?ref=dev" >/dev/null 2>"$ERR"; then
                if grep -q "HTTP 404" "$ERR"; then
                  echo "WARN: rust-checks.yml is not on dev yet -- skipping Rust checks for this PR" >&2
                  exit 0
                fi
                echo "ERROR: could not check whether rust-checks.yml is on dev: $(cat "$ERR")" >&2
                exit 1
              fi
              if ! SHA=$(gh pr view "$CHANGE_ID" --json headRefOid --jq .headRefOid 2>"$ERR"); then
                echo "ERROR: could not look up the head commit of PR #$CHANGE_ID: $(cat "$ERR")" >&2
                exit 1
              fi
              REQUEST_ID="pr${CHANGE_ID}-b${BUILD_NUMBER}-$(date +%s)"
              if ! gh workflow run rust-checks.yml --ref "$CHANGE_BRANCH" -f sha="$SHA" -f request_id="$REQUEST_ID" 2>"$ERR"; then
                echo "ERROR: could not dispatch rust-checks.yml for $SHA (the gh token needs Actions: write): $(cat "$ERR")" >&2
                exit 1
              fi
              RUN_ID=""
              for i in $(seq 1 30); do
                RUN_ID=$(gh run list --workflow rust-checks.yml --event workflow_dispatch --limit 30 \\
                  --json databaseId,displayTitle \\
                  --jq "[.[] | select(.displayTitle | endswith(\\"$REQUEST_ID\\"))][0].databaseId // empty")
                [ -n "$RUN_ID" ] && break
                sleep 5
              done
              if [ -z "$RUN_ID" ]; then
                echo "rust-checks run for $REQUEST_ID never appeared" >&2
                exit 1
              fi
              echo "Waiting on rust-checks run $RUN_ID"
              gh run watch "$RUN_ID" --exit-status --interval 20
            '''
          }
        }
      }
    }

    // ---- PR build only -------------------------------------------------

    stage('Record tested tree') {
      when { changeRequest target: 'dev' }
      steps {
        // Everything above passed on this checkout -- Jenkins' local merge
        // of the PR head with dev -- so record that merge's tree SHA as the
        // `gonq/tested-tree` commit status on the PR head. The dev build
        // reads it back (Resolve) and skips its Install/Test/Build when the
        // squash commit it builds has exactly this tree, i.e. dev did not
        // move in between. A tree SHA names the content, so a match means
        // the dev build would re-test byte-for-byte what passed here.
        //
        // Never fails the build: without the status the dev build simply
        // re-tests in full. The checkout is either the head itself (dev
        // already in it) or a merge whose first parent is the head; if the
        // PR head has moved since this build started, nothing is posted.
        sh '''
          set +e
          TREE=$(git rev-parse 'HEAD^{tree}')
          HEAD_SHA=$(gh pr view "$CHANGE_ID" --json headRefOid --jq .headRefOid)
          if [ -z "$TREE" ] || [ -z "$HEAD_SHA" ]; then
            echo "WARN: could not resolve the tested tree or PR #$CHANGE_ID's head -- gonq/tested-tree not posted; the dev build will re-test in full" >&2
            exit 0
          fi
          if [ "$(git rev-parse HEAD)" != "$HEAD_SHA" ] && [ "$(git rev-parse -q --verify 'HEAD^1')" != "$HEAD_SHA" ]; then
            echo "WARN: PR #$CHANGE_ID's head is now $HEAD_SHA, not the commit this build tested -- gonq/tested-tree not posted" >&2
            exit 0
          fi
          if gh api -X POST "repos/{owner}/{repo}/statuses/$HEAD_SHA" \
              -f state=success -f context=gonq/tested-tree \
              -f description="$TREE" -f target_url="$BUILD_URL" >/dev/null; then
            echo "gonq/tested-tree: $HEAD_SHA tested tree $TREE ($BUILD_URL)"
          else
            echo "WARN: could not post gonq/tested-tree on $HEAD_SHA -- the dev build will re-test in full" >&2
          fi
        '''
      }
    }

    stage('Queue merge to dev') {
      when {
        allOf {
          changeRequest target: 'dev'
          // Only ticket branches auto-merge. release/<sha> -> prod PRs (cut
          // by the release-candidate job) and anything else get tested here
          // but are never merged by this pipeline.
          expression { env.CHANGE_BRANCH ==~ /(feature|bugfix|chore)\/.*/ }
        }
      }
      steps {
        // Jenkins' own test gate is the only gate -- no tracker transition is
        // needed to reach this point.
        //
        // --auto, not a direct merge: this build's final commit status is
        // what dev's required check waits on, so merging synchronously here
        // is circular. --auto asks GitHub to merge the moment that status
        // lands; the push it makes to dev then triggers the dev build above.
        //
        // Jenkins checks PR builds out as a detached-HEAD merge commit, so
        // gh can't infer the PR from a branch -- pass CHANGE_ID explicitly.
        // Idempotent: a re-run of a build whose PR already has auto-merge
        // queued leaves it alone. Ask gh for a boolean: its --jq prints a JSON
        // null as an empty string, not the literal "null", so comparing the
        // raw autoMergeRequest object against "null" never matches and the
        // merge is silently skipped.
        //
        // The squash subject is pinned to "<PR title> (#N)" so the PR's
        // own number and title are always in dev's history for a human to
        // read. Resolution itself doesn't depend on it: the dev build finds
        // each promoted commit's merged PR from the commit SHA directly
        // (`gh api commits/$sha/pulls`, above), not by parsing this subject
        // for a tracker key (canonical-delivery-state.md REQ-01, REQ-02).
        sh '''
          AUTO_MERGE=$(gh pr view "$CHANGE_ID" --json autoMergeRequest --jq '.autoMergeRequest != null')
          if [ "$AUTO_MERGE" != "true" ]; then
            gh pr merge "$CHANGE_ID" --squash --auto --subject "$CHANGE_TITLE (#$CHANGE_ID)"
          else
            echo "auto-merge already queued for PR #$CHANGE_ID"
          fi
        '''
      }
    }

    // ---- dev build only ------------------------------------------------

    stage('Promote to beta and deploy') {
      when { expression { env.PIPELINE_KIND == 'dev' && env.PROMOTE_SHA != env.BETA_SHA } }
      steps {
        // Branches make batching free: this is a fast-forward of exactly
        // the tested commit, not a rebuild -- beta always mirrors dev. It's
        // rejected (and this build fails loudly) if beta has somehow
        // diverged, since beta requires linear history.
        //
        // A plain `git push` has no credentials -- the checkout step's
        // GIT_ASKPASS is scoped to that one operation. gitUsernamePassword
        // re-wires it for the push, and the log masks the token.
        withCredentials([gitUsernamePassword(credentialsId: 'github-token', gitToolName: 'Default')]) {
          sh 'git push origin "$PROMOTE_SHA:refs/heads/beta"'
        }

        // Restricted SSH key forced to a fixed deploy command; the Beta VM
        // builds the repo's Dockerfile (nginx serving the built web frontend).
        sh "ssh beta-deploy@\$BETA_VM_HOST deploy ${env.PROJECT_NAME} ${env.PROMOTE_SHA}"

        script {
          env.DEPLOYED_SHA = env.PROMOTE_SHA
          env.BUILD_IDENTIFIER = "${env.PROJECT_NAME}-${env.PROMOTE_SHA.take(7)}-${env.BUILD_NUMBER}"
        }
      }
    }

    stage('Publish the beta deployment') {
      when { expression { env.PIPELINE_KIND == 'dev' && env.PROMOTE_SHA != env.BETA_SHA } }
      steps {
        // ONE canonical event describing the deployment (V5.2 Canonical
        // Delivery State REQ-01): the promoted pull requests, the deployed
        // SHA, the build identifier, the build url and the beta url -- which
        // Jenkins builds from the project name and the platform cannot
        // derive. Nothing tracker-shaped is in it, and nothing here writes
        // to a tracker: the evidence comment and the move into review are
        // the platform's, made in one handler, evidence first (REQ-04,
        // REQ-05).
        //
        // Built with `jq` and published through the raw entry point of the
        // commons publish tool, which validates it before the write -- so a
        // malformed event fails this step rather than being dropped
        // server-side. The event is a gateway payload of its own `type`, not
        // an A2A message: Jenkins is not an agent, and A2A is the protocol
        // agents speak to each other.
        //
        // A failed publish marks the build UNSTABLE, not FAILURE. The
        // non-zero exit is caught in the shell, the way the failure handler
        // below catches its own, and the script block then sets UNSTABLE --
        // which a not-yet-failed build accepts. So a failed publish never
        // reaches the failure handler below, and never asks for a retry of a
        // build that passed.
        script {
          withEnv([
            "BETA_URL=http://gonq.beta.192.168.1.137.nip.io:8181",
            "PUBLISH_FAILURE_MARKER=.beta-deployed-publish-failure"
          ]) {
            sh '''
              rm -f "$PUBLISH_FAILURE_MARKER"
              PR_JSON=$(printf '%s\\n' $PROMOTE_PRS | jq -Rsc 'split("\\n") | map(select(length > 0))')
              jq -nc \
                  --argjson prs "$PR_JSON" \
                  --arg sha "$DEPLOYED_SHA" \
                  --arg build "$BUILD_IDENTIFIER" \
                  --arg url "$BUILD_URL" \
                  --arg beta "$BETA_URL" \
                  '{type:"beta_deployed",pull_requests:$prs,deployed_sha:$sha,build_identifier:$build,build_url:$url,beta_url:$beta}' \
                | node /agent-docs/commons/tools/gateway-publish.js "$PROJECT_NAME" - \
                || { echo "WARN: could not publish beta_deployed for $DEPLOYED_SHA" >&2; echo "$DEPLOYED_SHA" >> "$PUBLISH_FAILURE_MARKER"; }
            '''
            if (fileExists(env.PUBLISH_FAILURE_MARKER)) {
              echo "beta_deployed could not be published for ${env.DEPLOYED_SHA} -- " +
                   "the publish tool's own error is in this step's output above. " +
                   "beta carries the deployment; the platform has not been told about it."
              currentBuild.result = 'UNSTABLE'
            }
          }
        }
      }
    }
  }

  post {
    failure {
      script {
        // PR build: this PR. dev build: every pull request whose merge this
        // build was supposed to promote (resolved up front, so even a test
        // failure on the merged tip is attributed). Other builds (beta,
        // prod, release/<sha>, leftover branches) have nobody to tell, so
        // their failure is logged loudly instead -- they run no
        // Install/Test/Build, so a failure there is the pipeline itself.
        def promotedPrs = (env.PROMOTE_PRS ?: '').tokenize(' ').findAll { it }
        if (!promotedPrs) {
          echo "PIPELINE FAILURE with nobody to notify: ${env.BRANCH_NAME} build ${env.BUILD_NUMBER} " +
               "(kind ${env.PIPELINE_KIND ?: 'unresolved'}) names no pull request, so no pipeline_retry " +
               "is published. See the failing step above: ${env.BUILD_URL}"
        }
        if (promotedPrs) {
          def what = "Pipeline failed on the post-merge dev build (beta promotion / deploy for ${env.PROMOTE_SHA})."
          if (env.PIPELINE_KIND == 'pr') {
            what = "Pipeline failed on the PR build (PR #${env.CHANGE_ID}, ${env.CHANGE_BRANCH})."
          }
          // Jenkins looks nothing up here and writes to no tracker. It
          // publishes ONE message naming the pull requests it promoted, and
          // the platform does the rest: it resolves each reference to a work
          // item, appends the failure comment there (the same comment this
          // handler used to post to each ticket itself -- it survives, in
          // core), and publishes a retry carrying the canonical work-item id
          // so ScrumMaster can redispatch that item's recorded owner. The
          // message names no agent and no ticket.
          //
          // RETRY_FAILURE_MARKER is how a construction failure inside the
          // shell reaches the build's status: the shell cannot set a Groovy
          // build result itself, so it records the failure and carries on.
          // The script block below reads the marker and marks the build
          // UNSTABLE -- error() is deliberately not used anywhere in here,
          // because aborting would swallow the retry signal.
          // The whole handler is bounded. gateway-publish.js gives up on an
          // unreachable Redis in seconds of its own accord, but nothing else in
          // here does: a Redis host that blackholes instead of refusing would
          // leave this step running for the build's life -- and
          // `disableConcurrentBuilds()` above then queues every later dev
          // build behind it. `options` sets no global timeout, so this step
          // is the only bound (V5.0 audit row 9). If it fires, the handler is
          // cut short and the build stays FAILURE, which is what it already
          // was on entry -- nothing that has published so far is undone.
          timeout(time: 5, unit: 'MINUTES') {
            withEnv([
              "FAILED_PRS=${promotedPrs.join(' ')}",
              "FAILURE_TEXT=${what}",
              "RETRY_FAILURE_MARKER=.pipeline-retry-failures"
            ]) {
              sh '''
                rm -f "$RETRY_FAILURE_MARKER"
                PR_JSON=$(printf '%s\\n' $FAILED_PRS | jq -Rsc 'split("\\n") | map(select(length > 0))')
                jq -nc \
                    --argjson prs "$PR_JSON" \
                    --arg t "$FAILURE_TEXT" \
                    --arg u "$BUILD_URL" \
                    --arg n "$BUILD_NUMBER" \
                    '{type:"pipeline_retry",pull_requests:$prs,failure_text:$t,build_url:$u,build_number:$n}' \
                  | node /agent-docs/commons/tools/gateway-publish.js "$PROJECT_NAME" - \
                  || { echo "WARN: could not publish pipeline_retry for $FAILED_PRS" >&2; echo "$FAILED_PRS" >> "$RETRY_FAILURE_MARKER"; }
              '''
              if (fileExists(env.RETRY_FAILURE_MARKER)) {
                def unpublished = readFile(env.RETRY_FAILURE_MARKER).split('\n').findAll { it }
                echo "pipeline_retry could not be published for: ${unpublished.join(', ')} -- " +
                     "the publish tool's own error is in this step's output above. " +
                     "No work item has been told, and nobody will be redispatched for this build."
                currentBuild.result = 'UNSTABLE'
              }
            }
          }
        }
      }
    }
  }
}
