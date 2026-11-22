# Software Factory Repository Rules

- This repository holds the software factory: the lifecycle skills under `skills/` and the Command Center application. It is meant to be shared, so keep it free of personal skills and of real work details such as organization, people, or repository names.
- Skills say "the owner" for the person running the session; never name a person in a skill.
- Run `node --test` before committing. Keep the application free of package dependencies unless a story adds them deliberately.
- Keep the story store and Command Center harness-neutral. Anything specific to one agent harness belongs under `adapters/<harness>/`.
- When the `ai-sdlc` phases change, update the console's phases, the store's transitions, and the Jarvis phase table in the same change.
- Keep imported third-party skills self-contained. Vet an exact upstream revision before importing or updating one, and preserve its source and license.
- Profiles and story databases hold names and settings only. Never commit a profile or a database.
