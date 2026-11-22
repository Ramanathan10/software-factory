# Hook Setup Guide

Optional examples from the earlier tool-specific edition. The core skill needs no hook. Before enabling any adapter, check the current host's documented hook events, configuration schema, and permissions. These examples are not interchangeable across tools.

## Overview

Hooks enable proactive learning capture by injecting reminders at key moments:
- **UserPromptSubmit**: Reminder after each prompt to evaluate learnings
- **PostToolUse (Bash)**: Error detection when commands fail

## Claude Code Setup

### Option 1: Project-Level Configuration

Create `.claude/settings.json` in your project root:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "./skills/self-improvement/scripts/activator.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./skills/self-improvement/scripts/error-detector.sh"
          }
        ]
      }
    ]
  }
}
```

### Option 2: User-Level Configuration

Add to `~/.claude/settings.json` for global activation:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/skills/self-improvement/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

### Minimal Setup (Activator Only)

For lower overhead, use only the UserPromptSubmit hook:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "./skills/self-improvement/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

## Other tools

Do not copy the Claude Code JSON into Codex, Cursor, Copilot, or another tool. A skill can be invoked without a hook. If the owner asks for automatic reminders, confirm that tool's current hook API and test its event payload before adding a tool-specific configuration.

## GitHub Copilot Setup

For a repository that already uses `.github/copilot-instructions.md`, a manual reminder can live there. Check current Copilot documentation before assuming a hook is available or unavailable:

```markdown
## Self-Improvement

After completing tasks that involved:
- Debugging non-obvious issues
- Discovering workarounds
- Learning project-specific patterns
- Resolving unexpected errors

Consider logging the learning to `.learnings/` using the format from the self-improvement skill.

For high-value learnings that would benefit other sessions, consider skill extraction.
```

## Verification

### Test Activator Hook

1. Enable the hook configuration
2. Start a new Claude Code session
3. Send any prompt
4. Verify you see `<self-improvement-reminder>` in the context

### Test Error Detector Hook

1. Enable PostToolUse hook for Bash
2. Run a command that fails: `ls /nonexistent/path`
3. Verify you see `<error-detected>` reminder

### Dry Run Extract Script

```bash
./skills/self-improvement/scripts/extract-skill.sh test-skill --dry-run
```

Expected output shows the skill scaffold that would be created.

## Troubleshooting

### Hook Not Triggering

1. **Check script permissions**: `chmod +x scripts/*.sh`
2. **Verify path**: Use absolute paths or paths relative to project root
3. **Check settings location**: Project vs user-level settings
4. **Restart session**: Hooks are loaded at session start

### Permission Denied

```bash
chmod +x ./skills/self-improvement/scripts/activator.sh
chmod +x ./skills/self-improvement/scripts/error-detector.sh
chmod +x ./skills/self-improvement/scripts/extract-skill.sh
```

### Script Not Found

If using relative paths, ensure you're in the correct directory or use absolute paths:

```json
{
  "command": "/absolute/path/to/skills/self-improvement/scripts/activator.sh"
}
```

### Too Much Overhead

If the activator feels intrusive:

1. **Use minimal setup**: Only UserPromptSubmit, skip PostToolUse
2. **Add matcher filter**: Only trigger for certain prompts:

```json
{
  "matcher": "fix|debug|error|issue",
  "hooks": [...]
}
```

## Hook Output Budget

The activator is designed to be lightweight:
- **Target**: ~50-100 tokens per activation
- **Content**: Structured reminder, not verbose instructions
- **Format**: XML tags for easy parsing

If you need to reduce overhead further, you can edit `activator.sh` to output less text.

## Security Considerations

- Hook scripts run with the same permissions as Claude Code
- Scripts only output text; they don't modify files or run commands
- Error detector reads `CLAUDE_TOOL_OUTPUT` environment variable
- All scripts are opt-in (you must configure them explicitly)

## Disabling Hooks

To temporarily disable without removing configuration:

1. **Comment out in settings**:
```json
{
  "hooks": {
    // "UserPromptSubmit": [...]
  }
}
```

2. **Or delete the settings file**: Hooks won't run without configuration
