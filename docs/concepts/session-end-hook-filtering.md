# SessionEnd Hook for Accurate Session Filtering

**Date:** 2026-01-22
**Key Learning:** Use the SessionEnd hook to distinguish explicitly closed sessions from legitimately idle ones

---

## The Problem

Initial filtering approach:
```
Show sessions WHERE hasProcess = true
```

This still showed too many sessions because:
- Multiple old sessions exist in the same directory
- Can't distinguish the active session from historical ones
- Directory has 1 process but shows 10+ sessions

---

## The Solution: SessionEnd Hook

Claude CLI fires a **SessionEnd hook** when the user explicitly closes a session (Ctrl+C, exit, terminal close).

### Hook Data Available

```json
{
  "session_id": "c0e39980-1129-4d4e-9f98-931a2aaa48be",
  "transcript_path": "/Users/.../main.jsonl",
  "cwd": "/Users/.../project",
  "permission_mode": "acceptEdits",
  "hook_event_name": "SessionEnd"
}
```

The hook script writes `.ended.json` signal file:
```bash
~/.claude/session-signals/<session_id>.ended.json
```

### Daemon Tracking

Daemon sets `status: "idle"` **only when** `.ended.json` exists:

```typescript
// watcher.ts:648-650
if (hasEndedSig) {
  // Session ended - idle
  status = { ...status, status: "idle", hasPendingToolUse: false };
}
```

This is distinct from UI time-based idle (which we removed).

---

## Two-Tier Filtering

```typescript
// useSessions.ts
const activeSessions = sessions.filter(s =>
  s.hasProcess &&        // Has Claude process in directory
  s.status !== "idle"    // Not explicitly closed
);
```

### Filter Tier 1: hasProcess

**Meaning:** A Claude process is running in `session.cwd`

**Includes:** All sessions in directories with active processes

**Example:**
- 10 sessions in `/project`
- 1 Claude process in `/project`
- Result: All 10 pass tier 1

### Filter Tier 2: status !== "idle"

**Meaning:** SessionEnd hook has NOT fired (no `.ended.json`)

**Excludes:** Sessions that were explicitly closed

**Example:**
- 10 sessions pass tier 1
- 8 have `.ended.json` (user closed them)
- Result: 2 sessions remain

---

## Distinguishing "Idle" Meanings

| Source | Check | Meaning | Purpose |
|--------|-------|---------|---------|
| **Daemon** | `.ended.json` exists | Session explicitly closed via SessionEnd hook | Filtering: hide closed sessions |
| **UI (removed)** | `lastActivityAt` > 1 hour | No recent activity (time-based) | Visual label (now removed) |

**Key insight:** Only daemon's idle is definitive. UI time-based idle was unreliable.

---

## Debug Logging Added

All hook scripts now log to `~/.claude/session-signals/hooks-debug.log`:

```bash
=== SessionEnd hook called at Thu Jan 22 21:54:00 +08 2026 ===
{
  "session_id": "abc123",
  "cwd": "/Users/.../project",
  ...
}
```

This allows inspection of:
- What data Claude CLI provides
- When hooks fire
- Session lifecycle events

### Useful Debug Commands

```bash
# View all hook invocations
cat ~/.claude/session-signals/hooks-debug.log

# Count sessions with ended signals
ls ~/.claude/session-signals/*.ended.json | wc -l

# Check if specific session ended
ls ~/.claude/session-signals/<session-id>.ended.json
```

---

## Hook Signal Files

All signal files written to `~/.claude/session-signals/`:

| File Pattern | Written By | Meaning |
|--------------|------------|---------|
| `<id>.working.json` | UserPromptSubmit hook | User started a turn |
| `<id>.permission.json` | PermissionRequest hook | Waiting for approval |
| `<id>.stop.json` | Stop hook | Claude finished turn |
| `<id>.ended.json` | **SessionEnd hook** | **Session closed** |

The daemon watches this directory and updates session state accordingly.

---

## Impact on UI

**Before:**
- Showed 50+ sessions (all historical)
- No way to distinguish active from dead
- "idle" label based on time (unreliable)

**After:**
- Shows only sessions with processes AND not explicitly closed
- Typical: 2-5 sessions (the ones actually in use)
- No time-based idle computation

**Example reduction:**
- 59 sessions total
- 59 have `.ended.json` (explicitly closed)
- After filtering: 0 idle sessions shown (assuming no orphaned processes)

---

## Why This Works

The SessionEnd hook is **authoritative** because:

1. **Fires reliably** when user closes Claude (Ctrl+C, exit, terminal close)
2. **Survives daemon restart** (signal files persist on disk)
3. **No ambiguity** - either `.ended.json` exists or it doesn't
4. **Process-independent** - works even if process already died

Contrast with process detection alone:
- Can't map process to session (multiple sessions per directory)
- Process might die without SessionEnd hook (kill -9)
- Process might be orphaned but session legitimately closed

---

## Future Enhancement Possibilities

### Additional SessionEnd Data

The hook receives full JSON from Claude CLI. Could extract:
- Total message count
- Session duration
- Exit reason (normal vs crash)
- Final status

These could be written to `.ended.json` for richer session history.

### Cleanup on End

Could automatically delete old JSONL files when SessionEnd fires:
```bash
# In session-end.sh
rm "$TRANSCRIPT_PATH"
```

Not implemented because:
- User might want conversation history
- Daemon watches files, needs careful coordination
- Better to have explicit cleanup command

---

## Related Hooks

All hooks contribute to accurate state tracking:

1. **UserPromptSubmit** → `working` (user started turn)
2. **PermissionRequest** → `waiting` with pending tool (approval needed)
3. **Stop** → `waiting` (Claude finished)
4. **SessionEnd** → `idle` (session closed) ← **This one enables filtering**

The combination provides real-time, authoritative session state without polling JSONL files.
