# 0016. Private details are found without being written into the repository

Status: Accepted
Date: 2026-11-23

## Context
The repository is meant to be shared, so it must not carry the owner's name, other people's names, or work details such as a story prefix. A test that listed those words would itself carry them.

## Decision
`private-details.test.mjs` works out the words at run time from three sources: the GitHub owner's login (from `GITHUB_REPOSITORY_OWNER` or the `origin` remote), the git names in the history and the local `user.name`, and `PRIVATE_WORDS`, a comma-separated list set as a repository variable in CI.

The owner's login is the only source that gets prefixes. A nickname is usually the start of the login, so each word of the login counts as a whole word, and so does each prefix of three or more letters. A nickname that is not the start of the login goes in `PRIVATE_WORDS`.

Every other git name matches only as the whole full name, with its words in order, so a contributor named "Mark" or "Andrew Marks" does not ban `mark`, `and` or `the`. Bots and generic words are skipped. A word edge applies only where the entry itself starts or ends with a letter or digit, so an entry such as `PCS-` still matches `PCS-12`.

With no `origin` remote and no `GITHUB_REPOSITORY_OWNER`, the test fails and asks for one of them, because without an owner it cannot tell what to protect. The licence and community files are exempt because they name the copyright holder and where to report a problem.

## Consequences
- Contributors with common names no longer fail the test on ordinary words.
- A contributor whose full name is one ordinary word still fails on that word, and a contributor's first name on its own is no longer caught.
- An owner whose git name differs from their login gets no prefixes for the git name; list the nickname in `PRIVATE_WORDS`.
- In a fork clone, `origin` names the contributor, so their login's prefixes apply locally; CI uses the base repository's owner.
- Without `PRIVATE_WORDS` set, only names are checked.

## Where
- `private-details.test.mjs` — `privateWords`, `lineMatcher`, `exempt`
