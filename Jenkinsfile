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
//      Install -> Test -> Build, then `gh pr merge --auto`. GitHub squash-
//      merges the PR into `dev` once this build reports success. Nothing
//      beta- or review-status-related happens here. The work item stays In
//      Progress.
//
//   2. dev build (BRANCH_NAME = dev), triggered by the push that merge makes
//      Install -> Test -> Build again on the merged tip (the only build that
//      ever sees the real post-merge `dev`), then fast-forward `beta` to
//      exactly this commit, deploy it to the Beta VM, and publish ONE
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
          } else {
            // beta / prod / anything else: build-verify only.
            env.PIPELINE_KIND = 'other'
          }
        }
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Test') {
      steps {
        sh 'npm test'
      }
    }

    stage('Build') {
      steps {
        // Web build only; native Tauri builds run in GitHub Actions (build-desktop.yml).
        sh 'npm run build'
      }
    }

    // ---- PR build only -------------------------------------------------

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
        // failure on the merged tip is attributed). Other builds (beta/prod
        // verification) have nobody to tell.
        def promotedPrs = (env.PROMOTE_PRS ?: '').tokenize(' ').findAll { it }
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
