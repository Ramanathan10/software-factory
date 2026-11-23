# 0016. Private details are found without being written into the repository

Status: Accepted
Date: 2026-11-23

## Context
The repository is meant to be shared, so it must not carry the owner's name, other people's names, or work details such as a story prefix. A test that listed those words would itself carry them.

## Decision
`private-details.test.mjs` works out the words at run time: the GitHub owner (from `GITHUB_REPOSITORY_OWNER` or the `origin` remote), the git identities in the history and the local `user.name`, and `PRIVATE_WORDS`, a comma-separated list set as a repository variable in CI. A nickname is usually the start of a name, so each name's first three or more letters count as a whole word too. Bots and generic words are skipped. A word edge applies only where the entry itself starts or ends with a letter or digit, so an entry such as `PCS-` still matches `PCS-12`. The licence and community files are exempt because they name the copyright holder and where to report a problem.

## Consequences
- A short name produces short prefixes, which can match ordinary words; the generic list grows when that happens.
- Without `PRIVATE_WORDS` set, only names are checked.

## Where
- `private-details.test.mjs` — `privateWords`, `exempt`, `bounded`
