# Architecture decision records

Each record explains one decision the code cannot show by itself. Code in this repository carries no comments (0001); when you need a reason, look here, and when you make a decision a reader would not guess, add a record.

| No. | Decision |
|---|---|
| [0001](0001-code-carries-no-comments.md) | Code carries no comments; the reasons behind it live in ADRs |
| [0002](0002-decisions-reach-a-worker-through-the-daemon.md) | The owner's decisions reach a worker only through the daemon, one turn per session at a time |
| [0003](0003-the-daemon-watches-every-worker-turn.md) | The daemon watches every worker turn and records how it ended |
| [0004](0004-how-a-worker-program-is-started.md) | A worker's program runs detached, is watched for ten seconds, and is never started through a shell |
| [0005](0005-each-agent-harness-is-one-row.md) | Each agent harness is one row in one table |
| [0006](0006-a-worker-model-is-read-from-the-harness-record.md) | The model a worker ran on is read from the harness's own record, not stored |
| [0007](0007-one-phase-table-drives-lanes-and-model-tiers.md) | One phase table drives the dashboards' lanes and each phase's model tier |
| [0008](0008-install-links-skills-and-copies-only-when-needed.md) | Skills are linked where a harness allows, copied where it does not, and nothing is deleted |
| [0009](0009-entry-points-compare-real-paths.md) | Entry points compare real paths, and skill scripts stand alone |
| [0010](0010-the-dashboards-build-every-node.md) | The dashboards build every node themselves and never render a bare count |
| [0011](0011-badges-role-colors-and-notifications.md) | Badges, role colours and notifications show state without relying on motion or a second look |
| [0012](0012-jarvis-is-woken-only-for-news.md) | Jarvis is woken only for news, by a background wait that ends |
| [0013](0013-readiness-checks-only-read.md) | Readiness checks only read the tracker, and decide from a snapshot |
| [0014](0014-what-preflight-treats-as-a-problem.md) | What preflight treats as a problem, and where a repository's settings live |
| [0015](0015-model-checks-for-delivery-and-lifecycle.md) | Exhaustive model checks guard decision delivery and the story lifecycle |
| [0016](0016-private-details-are-found-without-being-written-down.md) | Private details are found without being written into the repository |
| [0017](0017-existing-story-databases-stay-where-they-are.md) | Existing story databases stay where they are, and the store holds its file open |
| [0018](0018-approved-plans-start-an-independent-test-worker.md) | Approved plans start an independent test author in the originating harness |
| [0019](0019-a-background-jarvis-session-is-woken-for-news.md) | A background Jarvis session is woken for news, so a story never waits on a chat |
