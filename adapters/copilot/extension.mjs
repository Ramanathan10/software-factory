import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { existsSync } from "node:fs";

// Installed, the command center sits beside this file; in the repository it is two folders up.
const installed = new URL("./command-center/console-service.mjs", import.meta.url);
const { createConsoleService } = await import(existsSync(installed) ? installed.href : "../../command-center/console-service.mjs");

const service = createConsoleService({    dbPath: process.env.AI_SDLC_CONSOLE_DB || undefined,
    // Event-driven: a decision the owner records in the console wakes the Jarvis chat immediately.
    onDecision: ({ story, seqs, types, session: worker }) => session?.send({
        prompt: `[Mission Console event] the owner recorded ${types.join(", ")} on story ${story} (event seq ${seqs.join(", ")}). ` +
            (worker
                ? `Forward it now with send_session_message (delivery_mode immediate) to the story worker session ${worker}, telling it to read the console, act on these events, ack them and continue. Do not do the phase work yourself.`
                : `No worker session is assigned; start or resume the story worker per the ai-sdlc Copilot app harness runbook.`),
    }),
});
const servers = new Map();
let shared;
let session;

const guard = (fn) => async (ctx) => {
    try {
        return fn(ctx.input ?? {});
    } catch (error) {
        throw new CanvasError(
            error?.status === 409 ? "story_changed" : "input_invalid",
            error instanceof Error ? error.message : String(error),
        );
    }
};

const object = (properties, required = []) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties,
});

session = await joinSession({
    canvases: [
        createCanvas({
            id: "ai-sdlc-console",
            displayName: "AI SDLC Command Center",
            description:
                "Live view of every AI SDLC story: phase, questions, plan approvals, workers, evidence and PRs. Stories originate from the Jarvis chat.",
            inputSchema: object({}),
            actions: [
                {
                    name: "get_snapshot",
                    description: "Return all stories and their current phase, open decisions and activity.",
                    inputSchema: object({ harness: { type: "string" } }),
                    handler: guard((input) => service.snapshot(input.harness)),
                },
                {
                    name: "create_story",
                    description: "Create a story in planning. Every AI SDLC story originates here.",
                    inputSchema: object(
                        {
                            story: { type: "string", minLength: 1 },
                            title: { type: "string", minLength: 1 },
                            detail: { type: "string" },
                            branch: { type: "string" },
                            worktree: { type: "string" },
                            harness: { type: "string", minLength: 1 },
                            repo: { type: "string", minLength: 1 },
                        },
                        ["story", "title", "harness"],
                    ),
                    handler: guard((input) => service.createStory(input)),
                },
                {
                    name: "record_event",
                    description:
                        "Record a Mission Console event (question, answer, plan, approve, activity, handoff, pr-opened...). Key and revision are filled in when omitted.",
                    inputSchema: {
                        type: "object",
                        required: ["story", "type"],
                        properties: { story: { type: "string" }, type: { type: "string" } },
                    },
                    handler: guard((input) => service.recordEvent(input)),
                },
                {
                    name: "pending",
                    description: "Return human decisions not yet acknowledged by Jarvis.",
                    handler: guard(() => service.pending()),
                },
                {
                    name: "ack",
                    description: "Acknowledge a decision once Jarvis has acted on it.",
                    inputSchema: object({ seq: { type: "integer" } }, ["seq"]),
                    handler: guard((input) => service.ack(input.seq)),
                },
                {
                    name: "handover",
                    description: "Return the full handover record for one story.",
                    inputSchema: object({ story: { type: "string" } }, ["story"]),
                    handler: guard((input) => service.handover(input.story)),
                },
                {
                    name: "attachments",
                    description: "List screenshots the owner attached to a story in the console (absolute paths).",
                    inputSchema: object({ story: { type: "string" } }, ["story"]),
                    handler: guard((input) => service.listAttachments(input.story)),
                },
            ],
            open: async (ctx) => {
                shared ??= await service.startServer(0);
                servers.set(ctx.instanceId, shared);
                return {
                    title: "AI SDLC Command Center",
                    status: "Live stories",
                    url: shared.url,
                };
            },
            onClose: async (ctx) => {
                servers.delete(ctx.instanceId);
                if (servers.size === 0 && shared) {
                    await shared.close();
                    shared = undefined;
                }
            },
        }),
    ],
});
