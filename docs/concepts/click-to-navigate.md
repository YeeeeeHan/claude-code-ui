# Click-to-Navigate: Dashboard to Terminal

Click any session row in the dashboard to jump directly to that Claude session's terminal pane.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      REGISTRATION (on session start)            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Claude starts in tmux pane                                     │
│         │                                                       │
│         ▼                                                       │
│  SessionStart hook fires                                        │
│         │                                                       │
│         ▼                                                       │
│  Writes ~/.claude/session-signals/{sessionId}.pane.json         │
│    {                                                            │
│      "session_id": "abc123",                                    │
│      "tmux_pane": "%5",                                         │
│      "tmux_session": "work",                                    │
│      "tmux_window": "0"                                         │
│    }                                                            │
│         │                                                       │
│         ▼                                                       │
│  Daemon watcher detects file → stores mapping in memory         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      NAVIGATION (on click)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User clicks row in dashboard                                   │
│         │                                                       │
│         ▼                                                       │
│  UI calls POST /api/navigate/{sessionId}                        │
│         │                                                       │
│         ▼                                                       │
│  Daemon looks up pane info                                      │
│         │                                                       │
│         ├── Not found → 404 error → UI shows toast              │
│         │                                                       │
│         ▼                                                       │
│  Daemon runs:                                                   │
│    tmux select-window -t {session}:{window}                     │
│    tmux select-pane -t {pane}                                   │
│    osascript -e 'tell app "iTerm2" to activate'                 │
│         │                                                       │
│         ▼                                                       │
│  iTerm2 focuses with correct pane selected                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Requirements

- **tmux**: Sessions must run inside tmux (regular or `-CC` mode)
- **iTerm2**: macOS terminal (for focus activation)
- **jq**: Required by hooks to parse JSON

## Installation

### One-time setup

```bash
./packages/daemon/scripts/setup-hooks.sh
```

This:
1. Copies hooks to `~/.claude/hooks/`
2. Makes them executable
3. Updates `~/.claude/settings.json`

### Verify installation

```bash
ls -la ~/.claude/hooks/
# Should show: session-start.sh, user-prompt-submit.sh, etc.

cat ~/.claude/settings.json | jq '.hooks | keys'
# Should include: SessionStart, UserPromptSubmit, etc.
```

## Global Hooks

Hooks are installed globally at `~/.claude/hooks/` (not in the repo). This means:

- Works with any/all clones of the repo
- Works even if you delete the repo
- Single source of truth

```
~/.claude/
├── hooks/
│   ├── session-start.sh       # Registers tmux pane
│   ├── user-prompt-submit.sh  # Marks session working
│   ├── permission-request.sh  # Marks waiting for approval
│   ├── stop.sh                # Marks waiting for input
│   └── session-end.sh         # Marks session idle
├── session-signals/           # Signal files (auto-created)
└── settings.json              # Hook configuration
```

## Usage

1. Start a tmux session: `tmux new -s work`
2. Start Claude inside tmux: `claude`
3. Open the dashboard
4. Click any session row → iTerm2 focuses with that pane

## tmux -CC Mode

Works with iTerm2's tmux integration mode (`tmux -CC`). The `tmux select-window` command triggers iTerm2 to switch native tabs via the control channel.

## Troubleshooting

### Click does nothing / error toast

**Cause**: Session wasn't started in tmux, or hook didn't fire.

**Check**:
```bash
ls ~/.claude/session-signals/*.pane.json
```

If no `.pane.json` files exist, the SessionStart hook isn't running.

### "Pane not found" error

**Cause**: tmux pane no longer exists (session ended, pane closed).

**Solution**: Start a new Claude session in tmux.

## API Reference

### POST /api/navigate/:sessionId

Navigates to the tmux pane for the given session.

**Response (success)**:
```json
{
  "success": true,
  "pane": "%5",
  "session": "work",
  "window": "0"
}
```

**Response (not found)**:
```json
{
  "error": "Pane not found",
  "message": "No tmux pane registered for this session..."
}
```

## Files Modified

| Component | File | Purpose |
|-----------|------|---------|
| Hook | `~/.claude/hooks/session-start.sh` | Writes pane info on session start |
| Daemon | `packages/daemon/src/watcher.ts` | Reads pane files, stores mapping |
| Daemon | `packages/daemon/src/serve.ts` | API server with `/api/navigate` endpoint |
| UI | `packages/ui/src/utils/api.ts` | API client |
| UI | `packages/ui/src/components/SessionTable.tsx` | Click handler |
