---
name: grill-me
description: Interview the owner to settle the decisions behind a plan or design. Use when they ask to grill an idea, stress-test a plan, or when AI SDLC begins planning. Stop for their approval before implementation.
---

# Grill Me

Map the idea as a design tree: each decision can unlock dependent decisions. Work in rounds. The frontier is the set of decisions whose prerequisites are settled; ask those questions together, with a recommended answer for each. Word each question so a simple "yes" accepts your recommendation. Wait for the owner's answers, update the tree, and ask the next frontier. Do not ask a question that depends on another unanswered question in the same round.

Find facts in the repository or environment yourself. Ask the owner to make decisions, not to retrieve facts you can inspect. When a fact is still being investigated, continue with independent questions and return to dependent ones afterward.

Finish when the frontier is empty. Summarize the proposed plan and wait for the owner to confirm the shared understanding. Do not edit the target repository, implement, or open a PR during this interview. AI SDLC owns the later phases.

## Source

Adapted from Matt Pocock's [Grill Me and Grilling](https://github.com/mattpocock/skills/tree/a496f5513d4a4cf889bc48e189e579f4b0bdf6aa/skills/productivity) at commit `a496f55`. The upstream wrapper only invoked Grilling, so its interview instructions are incorporated here. MIT license: [LICENSE](LICENSE).
