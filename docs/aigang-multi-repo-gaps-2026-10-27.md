<!-- Redacted operator notes: host paths, LAN address and session identifiers removed. AI Gang file:line references are to the AI Gang repository as installed on the build VM at the time (dev, after PR #55). -->

# AI Gang field notes: multi-repo projects, gaps found 2026-10-27

Written while planning a mobile version of Gonq. The plan wanted several repos (a shared Rust core, the desktop app, a mobile app) and the question was whether AI Gang can run one project across them.
Scope: how AI Gang handles more than one repository per project. Gonq product work is in the work-item history, not here.
Method: **read-only code and docs review, plus one independent second opinion. Nothing was run, built or changed.** No change was pushed to the AI Gang repository.

## Summary for AI Gang source

The docs promise multi-repo projects. The routing layer would carry them, but the rest of the platform is built around exactly one repository per project, and nothing multi-repo has ever been run or tested. The "Adding a repo to an existing project" path in the docs is an unwritten TODO.

| # | Area | Gap | Severity |
|---|---|---|---|
| 1 | Docs | "Adding a repo to an existing project" is a TODO | High |
| 2 | Project init | `init-project.sh` hard-codes one `src/` and one container | High |
| 3 | Docs vs code | The documented multi-repo layout (`frontend/`, `backend/`) contradicts the layout the code uses (`src/`) | High |
| 4 | Releases | One Release means one repo and one SHA; Jenkins release jobs are hard-wired to `projects/<name>/src` | High |
| 5 | Work items | No repo field; links cannot cross projects | High |
| 6 | Routing | Routing is by agent role, so two repos with the same role collide | Medium |
| 7 | Agent catalog | Docs name suffixes (`mobile`, `api`, `web`) that no agent in `agents.json` owns | Medium |
| 8 | Refinement | One refinement session sees one `/workspace`, so it plans without seeing the other repos | Medium |
| 9 | Librarian | Artifact delivery targets `<project>/src` only | Medium |
| 10 | Jenkins PR job | The multibranch source is one hard-coded repository | Medium |
| 11 | Config identity | A project's `repository.url` is locked after first success; a second repo cannot be recorded | Low |
| 12 | Tests | No test runs two repos in one project | High |

## What works

| Area | Evidence |
|---|---|
| Routing key is `(project, role suffix)`, so a frontend and a backend container for one project would each get their own stream | `services/scrummaster/src/registry.js:209-210` (`aigang:agent:${project}:${suffix}`); `services/scrummaster/src/handlers.js:73` |
| A container can be scoped to a role suffix | `setup/subscriber.js:110-116` (`AGENT_CHANNEL_SUFFIX`, `AGENT_CHANNEL_SUFFIXES`) |
| Delivering one artifact to two different **projects** is tested | `services/core/tests/test_librarian_resolution.py:118` (`test_the_same_artifact_reaches_a_second_repository_independently`; the "repositories" there are `hello-web` and `hello-desktop`, two projects) |

## Gaps

| # | Gap | Evidence | Why it breaks | Suggested fix |
|---|---|---|---|---|
| 1 | The documented path for adding a repo does not exist. | `docs/ClaudeInstructions.md:824`: "**TODO: Define this path fully.** Known steps: ... 2. Run `init-project.sh` for the new repo (it can be run multiple times for the same project)". | Step 2 is not true (gap 2). Anyone following the TODO would resume into the existing `src/`. | Write the path, or remove the claim until it is built. |
| 2 | `init-project.sh` supports exactly one repository and one container. | `scripts/init-project.sh:716` `SRC_DIR="$PROJECT_DIR/src"`; `:755-764` the generated compose has a single `dev` service with `./src:/workspace`; `:784-789` the generated `.env` has `PROJECT_NAME`, `REDIS_HOST`, the credential and `GH_TOKEN` but no `AGENT_CHANNEL_SUFFIX`. | Re-running for the same project resumes into the same `src/` (the config-identity check also refuses a changed repository, gap 11). A second repo has no scaffolding and no suffix. | Parameterize the repo directory and service name (`--repo <name> --role <suffix>`), write the suffix into `.env`, append a service to the compose file instead of overwriting it. |
| 3 | The documented multi-repo layout is not the layout the code uses. | `docs/UserGuide.md:358-364` shows `projects/myapp/frontend/` and `projects/myapp/backend/`. Code assumes `projects/<name>/src`: `jenkins/jenkins.yaml:93` and `:223`, `services/core/librarian/paths.py:100-108`, `scripts/init-project.sh:716`. | Following the documented layout makes Jenkins and the librarian look in a directory that does not exist. The guide's hand-written compose has never been run against this platform. | Pick one layout (for example `projects/<name>/<repo>/`), make every consumer read it from one place, and document it once. |
| 4 | A Release is one repo, one SHA, and the release jobs are hard-wired to one directory. | `services/core/workitems/models.py:132` `candidate_sha` is one column on `WorkItemReleaseDetail`. `jenkins/jenkins.yaml:93` and `:223`: `PROJECT_DIR = "/home/aigang/ai-gang/projects/${PROJECT_NAME}/src"`; `:126` `preview-deploy ${PROJECT_NAME} ${CANDIDATE_SHA} ${WORK_ITEM_ID}`. | The candidate pin, the `release/<sha>` branch, the frozen PR, the Beta preview and the promote all act on one repo. A project with two repos cannot release both, and cannot release them together. | Decide the model first (a Release per repo, or a Release that carries one SHA per repo). Then key the release jobs and the preview deploy by `(project, repo)`. |
| 5 | Work items know nothing about repositories, and links cannot cross projects. | `services/core/workitems/models.py:59` `project = models.TextField()` and no repo field anywhere on `WorkItem`. `services/core/workitems/store.py:1292-1293`: "createLink: work items must belong to the same project". | The obvious workaround, one AI Gang project per repo, loses `blocks` chaining between a core story and the app stories that depend on it. The other workaround, one project with several repos, has nowhere to record which repo a subtask targets. | Add an optional `repo` to subtasks and a dispatch check that it matches the receiving container. Separately, decide whether cross-project `blocks` links should be allowed. |
| 6 | Routing is by agent role, so two repos with the same role cannot be told apart. | `services/scrummaster/src/handlers.js:73` picks the stream from `agent.routing.channelSuffix` only; there is no repo in the message. `docs/ClaudeInstructions.md:233-236`: "N repos → N containers. Each container subscribes only to its own agent channel." | A desktop UI repo and a mobile UI repo are both "frontend". They would share one stream and one container, or need a new agent. | Either add a repo dimension to the stream name, or document the rule "one repo per role" and say so up front. |
| 7 | The docs name suffixes that no agent owns. | `docs/ClaudeInstructions.md:236` lists `frontend`, `backend`, `mobile`, `api`, `web`. `services/scrummaster/config/agents.json` has only `refinement`, `backend`, `frontend`, `devops`, `desktop`. | A container started with `AGENT_CHANNEL_SUFFIX=mobile` would consume a stream nothing publishes to, silently. | Validate at container start that the suffix exists in `agents.json`, and say so in the docs. Document how to add an agent. |
| 8 | Refinement decomposes from inside one container's checkout. | `setup/agents/refinement-agent.md:50` ("One subtask per agent role"); the refinement container's `/workspace` is one repo. | With several repos the refinement agent writes subtasks for repos it cannot read. Cross-repo contract decisions (the FE/BE contract problem) are made blind. | Mount all of a project's repos read-only into the refinement container, or give refinement a repo list in the work item. |
| 9 | The librarian delivers into `<project>/src` only. | `services/core/librarian/paths.py:100-108`: a project without the configured subdirectory is answered `unknown_destination_repo`; the module docstring says "The repository is the project's `src/`, not the project directory." | Delivering a design asset to a second repo in the same project fails. | Let `destination_repo` name a repo inside a project, or document that it cannot. |
| 10 | The multibranch PR job is one hard-coded repository. | `jenkins/jenkins.yaml:348-354` defines one source (`hello-world-source`, one `repoOwner`/`repository`). The Gonq pipeline job is defined outside `jenkins.yaml`. | Each repo needs its own job, and nothing generates it. | Generate a job per registered repo from `projects.json`. |
| 11 | A project's repository is locked after first success. | `docs/UserGuide.md:225-229`: changing `repository.url` "is refused, with nothing touched". `ai-gang.config.template.json` has a single `repository.url`. | This is deliberate, but it means there is no place to record a second repository for a project. | Change `repository` to a list when gap 2 is fixed. |
| 12 | Nothing tests two repos in one project. | `projects/` holds only single-repo projects. The only multi-"repository" test is the cross-project delivery above. | The docs' multi-repo claim has never been exercised, so every gap above was invisible. | See "Suggested tests". |

## Suggested tests (offline, no live install)

1. Registry: a `projects.json` fixture with two roles for one project; assert both streams are named correctly and that a task for each lands on its own stream.
2. `init-project.sh` against a temp `projects.json` (`AIGANG_PROJECTS_CONFIG` already allows this): run it twice for one project with two repos and assert the second run does not overwrite the first repo or its compose service.
3. Work items: assert the intended behaviour of `createLink` across projects (today it raises; a test makes the rule explicit).
4. Suffix validation: a container started with a suffix not in `agents.json` fails loudly.
5. Releases: a design test for a project with two repos, written before any code.

## What the Gonq mobile plan does about this

Gonq will not use multi-repo support for the mobile app. The agreed plan is a single repo converted to Cargo and npm workspaces (`crates/gonq-core`, `packages/editor`, `apps/desktop`, `apps/mobile`), so one project, one container, one Release and one SHA, with links intact.
The first story is a workspace conversion with no behaviour change, to check that one container and the Jenkins PR build cope with it. The gaps above remain open for any project that really needs several repos.

## Provenance

- Read-only review by the orchestrating Claude Code session, with an independent second review by a separate model session that read the same files. Both found the same single-repo assumptions; the second review is the source of gaps 6-8 and 10.
- The first reviewer re-checked the line references against the files. The sections quoted in gap 9 and the `jenkins.yaml` source block in gap 10 were read but not run.
- Nothing was built, run or deployed. Treat each gap as "found by reading", not "reproduced".
