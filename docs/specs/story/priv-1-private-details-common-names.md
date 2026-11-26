# PRIV-1 spec: the private-details test fails for contributors with common names

Work item: GitHub issue #56. Branch `story/priv-1-private-details-common-names`, cut from origin/main 88b9cce. Context pack: `C:/Users/trojanmini/.ai-sdlc/stories/PRIV-1/context-pack.md`.

## Problem

`private-details.test.mjs` (`privateWords`) bans every prefix of 3+ letters of every word in the GitHub owner, every git author and committer, and the local `user.name` (ADR 0016, so a nickname is caught). Applied to every contributor, this bans ordinary words. It also reads `git remote get-url origin` with no guard.

Reproduction on 88b9cce, Node 24.18.0, Windows 11, with `user.name` overridden per process:

| user.name | Failing lines | Words that hit |
|---|---|---|
| Andrew Marks | 3,718 | and, marks, mark |
| Theodore | 5,957 | the |
| Ford | 2,174 | for |
| Willa | 54 | will, wil |
| Mark | 72 | mark |

With no `origin` remote and no `GITHUB_REPOSITORY_OWNER`, the test throws `Command failed: git remote get-url origin`. Evidence: `repro-*.txt` beside the context pack.

## Settled decisions

1. Prefixes (nickname catch) come only from the owner's GitHub login: `GITHUB_REPOSITORY_OWNER`, else the `origin` remote. Each 3+ letter prefix of each login word counts as a whole word, as today.
2. Every other git name (history authors and committers, local `user.name`) is matched as its whole full name, words in order (for example "Andrew Marks"), not word by word and not by prefix. Bots and the generic list are still skipped.
3. `PRIVATE_WORDS` is unchanged, including the edge rule for entries such as `ZZQ-`.
4. With no `origin` remote and `GITHUB_REPOSITORY_OWNER` unset, the test fails with a clear message that asks for an `origin` remote or `GITHUB_REPOSITORY_OWNER`. It does not throw a raw git error.
5. ADR 0016 is edited in place to state the new rule (owner login gets prefixes; other names match in full; the missing-owner failure) and its Consequences updated. No new ADR.
7. The nickname catch stays tied to the owner's GitHub login only. ADR 0016 says that a nickname that is not the start of the login goes in `PRIVATE_WORDS` (the CI repository variable, or the environment locally).
6. `privateWords` is refactored to take its sources (owner, git names, `PRIVATE_WORDS`) as input, so unit tests can feed invented values. The real test still reads git.

## Acceptance criteria

- On an unchanged checkout, `node --test private-details.test.mjs` passes with `user.name` set to "Andrew Marks", "Theodore", "Ford", "Willa" or "Mark Smith".
- For an invented owner login, a tracked line holding the login or a 3+ letter prefix of it is reported.
- A tracked line holding a contributor's full name is reported; a line holding only one of that contributor's words (for example "and" or "Marks" alone) is not.
- A `PRIVATE_WORDS` entry, including one ending in a non-letter such as `ZZQ-`, is reported.
- With no owner available, the test fails with the message naming `origin` and `GITHUB_REPOSITORY_OWNER`, not a git exception.
- The repository's own check still passes for the owner (baseline unchanged).
- `node --test` and gitleaks pass; no new comments (ratchet); only invented names in tests, ADR and PR.

## Test level

Unit tests in `private-details.test.mjs` that feed invented owners, git names and `PRIVATE_WORDS` to the word builder and its matcher. No temporary git repositories.

## Known limits (accepted)

- A contributor whose git name is one ordinary word (for example "Mark") still fails.
- A contributor's first name on its own is no longer caught.
- In a fork clone, `origin` names the contributor, so their login's prefixes apply locally; CI uses the base repository's owner.
- An owner whose git name differs from their login gets no prefix catch for the git name; a nickname from it must be listed in `PRIVATE_WORDS`.

## Plan critique

Codex (gpt-6-sol, read-only) reviewed the draft. Three findings: the owner git-name nickname gap (asked and settled as decision 7), and the one-word ordinary name and fork-clone cases (already accepted limits). No unresolved objections.

## Out of scope

An ordinary-word list; the profile/database test; CI checkout depth; AGENTS.md (its description stays accurate).

## Run decisions

- Before and after: skipped. Before/after test output goes into the PR description as text.
- Architecture diagram: skipped.
- From the profile: gates `node --test` and gitleaks; spec committed at `docs/specs/story/priv-1-private-details-common-names.md` as the branch's first commit; implementation level full; review round limit 3; cross-model sharing authorized.


## Context pack

### PRIV-1 context pack

Issue #56: the private-details test fails for contributors with common names. Branch `story/priv-1-private-details-common-names`, cut from origin/main 88b9cce.

## Reproduction (unchanged code, Node 24.18.0, Windows 11)

`user.name` overridden per process with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0="<name>"`, so the shared repo config is untouched.

| user.name | Failing lines | Banned words that hit |
|---|---|---|
| (owner's own, baseline) | 0 (pass) | — |
| Andrew Marks | 3,718 | and 3,611, marks 64, mark 43 |
| Theodore | 5,957 | the |
| Ford | 2,174 | for |
| Willa | 54 | will 53, wil 1 |
| Mark | 72 | mark (the whole name, not a prefix) |

The `node --test private-details.test.mjs` run with "Andrew Marks" fails with 3,618+ reported lines (`repro-andrew-marks.txt`). The last row matters: matching whole names instead of prefixes does not fix the bug on its own. A contributor whose first name is an ordinary word still fails.

Second symptom, confirmed by running it: in a clone with no `origin` remote and no `GITHUB_REPOSITORY_OWNER`, the test throws `Command failed: git remote get-url origin` instead of reaching a verdict (`repro-no-origin.txt`).

Evidence: `C:\Users\trojanmini\.ai-sdlc\stories\PRIV-1\repro-*.txt`.

## Root cause

`private-details.test.mjs`, `privateWords`:

- Line 13 reads `git remote get-url origin` with no guard; `execFileSync` throws when the remote is missing.
- Lines 14-18 collect words from the GitHub owner, every author and committer in `git log`, and the local `user.name`, all treated the same way.
- Line 20 adds every prefix of 3+ letters of every such word. ADR 0016 chose this so a nickname (the start of a name) is caught. Applied to every contributor, it bans common words such as "and", "the", "for", "mark", "will".
- The `generic` list (line 15) is the only escape hatch. ADR 0016 says it "grows when that happens", which does not scale to every contributor.

Matching is already whole-word (`bounded`), so the problem is which words are banned, not how they match.

## Relevant files

- `private-details.test.mjs`: the whole check, two tests. `privateWords(env)` already takes `env` but reads git directly.
- `docs/adr/0016-private-details-are-found-without-being-written-down.md`: records the prefix rule for every name. The fix changes that decision, so it needs a new ADR (next free number at publish time; currently 0023 would be next) that supersedes the prefix sentence.
- `AGENTS.md` line 31: describes the test (owner's name, nickname, `PRIVATE_WORDS`, profile/database). Wording stays true under the recommended fix.
- `.github/workflows/test.yml`: CI sets `PRIVATE_WORDS` from a repo variable; `actions/checkout` at default depth 1, so CI `git log` holds only the merge commit. Approaches that diff against main's history are not available in CI.
- `comment-ratchet.json`: `private-details.test.mjs` has no entry, so it must stay at zero comments.

## Current identities in this repository

`git log` holds the owner's login, "GitHub" (filtered as generic) and dependabot (filtered as a bot). The owner's login is the only real name source today.

## Conventions and rules

- AGENTS.md: no owner's name, nickname, people, organization or repository names in tracked files; skills say "the owner". Tests and fixtures must use invented names only.
- No comments in source (ratchet). No package dependencies. `node --test` before committing; e2e (`node e2e/run.mjs`) runs in CI and is not affected by this file.
- The lifecycle and delivery models are not touched (no store, roles, harness or daemon change).

## Commands

- Focused: `node --test private-details.test.mjs`
- Full: `node --test`; gates: `node --test`, `gitleaks git --no-banner --log-opts=origin/main..HEAD`.
- Reproduce with a name: prefix the focused command with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0="Andrew Marks"`.

## Similar earlier changes

- e53007f (#7) introduced the test; its PR body lists the leaks it catches (the owner's nickname in four lines at a7e7826^, a work story prefix via `PRIVATE_WORDS`). Any fix must still catch both.
- b614a82 (#17) only touched comments.

## Risks

- Dropping prefixes for the owner loses the nickname catch that found the historical leaks.
- An ordinary-word list would excuse an owner nickname that is also an English word, and needs a vetted third-party list with a licence.
- In a fork clone, `origin` points at the contributor's fork, so "the owner" derived from `origin` is the contributor locally. CI is unaffected: pull_request runs carry the base repository's `GITHUB_REPOSITORY_OWNER`.
- Tests that exercise the word builder must inject an invented owner and identities, not read this repository's git.
