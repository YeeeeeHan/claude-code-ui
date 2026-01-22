# How Daemon Handles Ended Sessions

**Date:** 2026-01-22
**Context:** Understanding the lifecycle of session termination and signal file processing

---

## The SessionEnd Hook Flow

### 1. Claude CLI Closes

User closes Claude via:
- `Ctrl+C`
- `exit` command
- Terminal tab close
- Terminal app quit

### 2. Claude CLI Fires SessionEnd Hook

Sends JSON to the hook script via stdin:

```json
{
  "session_id": "c0e39980-1129-4d4e-9f98-931a2aaa48be",
  "transcript_path": "/Users/.../main.jsonl",
  "cwd": "/Users/.../project",
  "permission_mode": "acceptEdits",
  "hook_event_name": "SessionEnd"
}
```

### 3. Hook Script Writes Signal File

`session-end.sh` creates:
```
~/.claude/session-signals/<session_id>.ended.json
```

**Critical:** Also deletes ALL other signal files for this session:
```bash
rm -f "$SIGNALS_DIR/$SESSION_ID.working.json"
rm -f "$SIGNALS_DIR/$SESSION_ID.permission.json"
rm -f "$SIGNALS_DIR/$SESSION_ID.stop.json"
```

This prevents conflicting signals (e.g., session is both "working" AND "ended").

### 4. Daemon Detects Signal File

The daemon watches `~/.claude/session-signals/` via `chokidar`.

When `.ended.json` appears:
1. `signalWatcher.on("add")` fires
2. Calls `handleSignalFile(filepath)`
3. Parses filename to extract session ID and type
4. Adds to `this.endedSignals` Map
5. Attempts to update the session

---

## The Timing Problem

### Startup Sequence

```
1. watcher.on("ready") - JSONL files scanned, sessions created
2. loadExistingSignals() - Signal files loaded
3. Sessions already exist, signals already loaded
```

**Problem:** For sessions created in step 1, `handleSignalFile()` runs but sessions don't exist yet.

```typescript
// handleSignalFile() - line 309
const session = this.sessions.get(sessionId);
if (session) {
  // This is null during startup if JSONL was processed before signal!
}
```

### Runtime Sequence (New Session)

```
1. User closes Claude
2. SessionEnd hook writes .ended.json
3. signalWatcher detects file
4. handleSignalFile() runs
5. Session exists, gets updated to idle ✓
```

**Works correctly** for sessions closed after daemon starts.

---

## The Solution: Reconciliation

Added `reconcileSessionsWithSignals()` called after `loadExistingSignals()`:

```typescript
// After signals are loaded, update all existing sessions
private reconcileSessionsWithSignals(): void {
  for (const session of this.sessions.values()) {
    const hasEndedSig = this.endedSignals.has(sessionId);

    if (hasEndedSig) {
      session.status.status = "idle";
      session.hasEndedSignal = true;
      this.emit("session", { type: "updated", session });
    }
  }
}
```

This ensures startup behavior matches runtime behavior.

---

## Signal Priority and Conflicts

### Priority Order (High to Low)

1. **ended** - Session definitively closed
2. **permission** - Waiting for tool approval
3. **stop** - Turn ended, waiting for user
4. **working** - Turn in progress

Applied in both `handleFile()` and `reconcileSessionsWithSignals()`.

### Why Priority Matters

If multiple signal files exist:
```
abc123.working.json   (created at 21:21)
abc123.ended.json     (created at 21:22)
```

**Without cleanup:** Daemon sees both, uses priority → "idle" (correct)

**With cleanup:** `session-end.sh` deletes `.working.json` → only `.ended.json` exists (cleaner)

### Historical Bug

Before the fix, `session-end.sh` didn't delete `.working.json`:
```bash
# Old (incomplete cleanup)
rm -f "$SESSION_ID.permission.json"
rm -f "$SESSION_ID.stop.json"
# Missing: rm -f "$SESSION_ID.working.json"
```

This left conflicting signals for ended sessions. Fixed by adding the `.working.json` deletion.

---

## Daemon State Updates

### Two Update Paths

| Path | Trigger | When |
|------|---------|------|
| **handleSignalFile()** | Signal file add/change | Real-time when hooks fire |
| **handleFile()** | JSONL file change | When new log entries written |

Both check `this.endedSignals.has(sessionId)` and set `status: "idle"`.

### State Mutations

When ended signal detected:

```typescript
// Update session object
session.hasEndedSignal = true;
session.hasWorkingSignal = false;
session.hasStopSignal = false;
session.pendingPermission = undefined;
session.status = {
  ...session.status,
  status: "idle",
  hasPendingToolUse: false,
};

// Emit update event
this.emit("session", {
  type: "updated",
  session,
  previousStatus,
});
```

The emit triggers `StreamServer.publishSession()` → UI update.

---

## Debug and Verification

### Check Signal Files

```bash
# List all ended sessions
ls ~/.claude/session-signals/*.ended.json

# Check for conflicting signals
cd ~/.claude/session-signals
for f in *.ended.json; do
  id="${f%.ended.json}"
  if [ -f "$id.working.json" ]; then
    echo "CONFLICT: $id has both ended and working"
  fi
done
```

### Check Daemon State

```bash
# See what daemon is publishing
curl -s http://127.0.0.1:4450/sessions | \
  jq '.[] | select(.value.status == "idle") | {id: .value.sessionId, status: .value.status}'
```

### Force Reconciliation

Restart daemon to trigger reconciliation:
```bash
pkill -f "claude-code-ui.*daemon"
# Daemon auto-restarts
# On startup: loadExistingSignals() + reconcileSessionsWithSignals()
```

---

## UI Filtering Impact

### Before Reconciliation Fix

```
Session has .ended.json → daemon shows "working" → UI displays it
```

**Result:** Ended sessions still visible

### After Reconciliation Fix

```
Session has .ended.json → daemon shows "idle" → UI filters it out
```

**Filter logic:**
```typescript
sessions.filter(s => s.hasProcess && s.status !== "idle")
```

---

## Edge Cases

### Case 1: Force Kill (kill -9)

Claude process killed without SessionEnd hook:
- No `.ended.json` created
- Session shows as "working" or "waiting" forever
- `hasProcess` eventually becomes false (process gone)
- Still shows in UI until process gone

**Mitigation:** Process detection handles this - once process dies, `hasProcess: false` → filtered out.

### Case 2: Daemon Restart During Session

1. User runs Claude
2. Daemon restarts
3. Daemon rescans JSONL files
4. Daemon loads signals

**Result:** Session state correctly reconstructed from both sources.

### Case 3: Orphaned .working.json

Before the hook fix, `.working.json` persisted after SessionEnd:
- Daemon sees both signals
- Priority: ended > working
- Shows as "idle" correctly in daemon
- But cleanup is cleaner

**Fixed by:** session-end.sh now removes `.working.json`

---

## Summary

**Ended session handling requires:**

1. ✅ SessionEnd hook installed in settings.json
2. ✅ Hook script writes `.ended.json`
3. ✅ Hook script deletes conflicting `.working.json`
4. ✅ Daemon loads signals on startup
5. ✅ Daemon reconciles existing sessions with signals
6. ✅ UI filters by `status !== "idle"`

The combination ensures:
- Real-time updates when sessions close
- Correct state after daemon restart
- Clean signal files without conflicts
- Accurate UI filtering

**Key insight:** Signal files are the source of truth for session lifecycle, not just status transitions.
