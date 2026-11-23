# Contributing

Thanks for wanting to improve the software factory. Bug reports, fixes, new harness rows and skill improvements are all welcome.

## Before you start

- For a bug, open an issue with what you ran, what you expected and what happened.
- For a larger change, open an issue first so the approach can be agreed before you write it.
- Report security problems privately; see [SECURITY.md](SECURITY.md).

## Set up

You need Node 24 or later (Node 22 works with `--experimental-sqlite`) and Git. There are no packages to install.

```
git clone <your fork>
cd software-factory
node --test
```

`node ./mission-console/jarvis.mjs demo` loads sample stories and `node ./command-center/serve.mjs` runs the Command Center against them.

## Rules for a change

[AGENTS.md](AGENTS.md) holds the rules for people and agents alike. The ones that most often matter:

- Run `node --test` before you commit. CI runs it on Windows, macOS and Linux.
- Keep the application free of package dependencies unless the change adds one deliberately and says why.
- Keep the story store and Command Center harness-neutral. Anything specific to one agent harness goes under `adapters/`, as one row in `adapters/harnesses.mjs`.
- When the `ai-sdlc` phases change, update the console's phases, the store's transitions and the Jarvis phase table in the same change.
- Skills say "the owner" for the person running the session. Do not name a person, organization or private repository anywhere in the repository.
- Never commit a profile or a story database.

## Third-party skills

An imported skill stays self-contained in its own folder. Vet an exact upstream revision before importing or updating one, record the source and the revision, and keep the upstream license file in the skill's folder.

## Pull requests

- One change per pull request, with tests for new behavior.
- Say what changed and why, and how you checked it. Add a screenshot for a visible change to the dashboard.
- By contributing you agree that your contribution is licensed under the repository's [MIT license](LICENSE).
