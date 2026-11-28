# End-to-end tests (Playwright)

The suite lives in `apps/desktop/e2e/` and has two projects: `chromium` (the desktop web build) and `mobile`
(the Pixel 7 profile against the mobile web build, served under `/mobile/`). `playwright.config.ts` builds and
serves both apps itself.

## Where it runs

- **Not per PR, and not in Jenkins.** Jenkins runs `npm ci` and `npm test` (Vitest, map, boundaries and version
  checks) only. A PR description must not say Jenkins ran the e2e.
- **At release time.** `release-desktop.yml` (on the `v*` tag Jenkins pushes) has an `e2e` job that calls
  `.github/workflows/e2e.yml` with the tagged commit. The `publish` job `needs` it, so a failing e2e stops the
  GitHub Release being created. `release-mobile.yml` is unchanged: it waits for that Release (up to 120 minutes),
  so if e2e fails it fails to attach, as it does when a desktop leg fails.
- **On demand by sha.** `e2e.yml` has `workflow_dispatch` with a required `sha` input. It checks out exactly that
  commit. The orchestrator dispatches it, for example once on the merge SHA of a change. Nobody dispatches it by
  hand from a PR, and it has no `pull_request`, `push` or `schedule` trigger.

On failure the run uploads the Playwright HTML report (`playwright-report-<sha>`) and the traces
(`playwright-test-results-<sha>`) as artifacts.

## Running locally

    npx playwright install chromium
    npm run test:e2e

On a shared box, keep the load down:

    cd apps/desktop && nice -n 19 npx playwright test --workers=1
