---
module: Claude Code UI - Session Tracking
date: 2026-01-22
problem_type: logic_error
component: tooling
symptoms:
  - "All sessions marked as LIVE including 10 background processes with TTY = ??"
  - "Live detection not filtering out background Claude sessions"
  - "Empty repo group headers showing in UI"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [session-detection, live-tracking, process-filtering, tty-check]
---

# Background Sessions Incorrectly Marked as LIVE

## Problem

The Claude Code UI session tracker was marking all Claude processes as "LIVE", including 10 background sessions (TTY = `??`) that had no active terminal connection. This resulted in:
- All 12 sessions showing "LIVE" badge when only 2 had active terminals
- Empty repo group headers in UI (sessions filtered out by SessionTable but groups still rendered)
- Confusing UX - users couldn't distinguish actively running sessions from orphaned background processes

## Symptoms

When running `ps aux | grep -E 'claude$'`:
```
PID: 39718 TTY: s001 STATUS: R+   ← Actually live (terminal 1)
PID: 42048 TTY: s002 STATUS: S+   ← Actually live (terminal 2)
PID: 28003 TTY: ?? STATUS: S      ← Background (no terminal)
PID: 58535 TTY: ?? STATUS: S      ← Background (no terminal)
... 8 more background sessions
```

All 12 sessions displayed LIVE badge in UI, even though only 2 had terminal connections.

## Investigation

### What We Tried

1. **Checked process detection logic**
   - Original implementation: `/packages/daemon/src/watcher.ts:459-501`
   - Used `pgrep -x claude` to find PIDs
   - Matched process CWD to session CWD
   - Problem: No TTY filtering

2. **Verified the issue was in detection, not UI filtering**
   - `SessionTable` correctly filtered `isLive` sessions
   - But repo grouping happened before filtering
   - Result: Empty groups with headers but no rows

3. **Created `/cleanup-sessions` command**
   - Killed background processes
   - Verified only 2 processes remained
   - But UI still showed empty repo groups (session files still existed)

## Root Cause

The `detectLiveSessions()` function matched Claude processes to sessions based solely on working directory (CWD) without checking if the process had an active terminal (TTY):

**Original approach (packages/daemon/src/watcher.ts:460-501):**
```typescript
// Step 1: Get all Claude process PIDs
const { stdout: pgrepOut } = await execAsync("pgrep -x claude 2>/dev/null || true");
const pids = pgrepOut.trim().split("\n").filter(Boolean);

// Step 2: Get working directory for each process
for (const pid of pids) {
  const { stdout: lsofOut } = await execAsync(`lsof -p ${pid} 2>/dev/null | grep cwd || true`);
  // Extract CWD and add to liveCwds set
}

// Step 3: Match sessions to live cwds
for (const session of this.sessions.values()) {
  if (liveCwds.has(session.cwd)) {
    liveSessionIds.add(session.sessionId); // ❌ Marks ALL sessions in directory as live
  }
}
```

This marked background processes as "live" because:
- `pgrep` doesn't provide TTY information
- CWD matching alone can't distinguish terminal-attached vs background processes
- Multiple sessions in same directory all marked live if ANY process matches CWD

## Solution

Updated detection to filter out background processes (TTY = `??`) before CWD matching:

**Updated approach (packages/daemon/src/watcher.ts:460-501):**
```typescript
// Step 1: Get all Claude processes WITH TTY info
const { stdout: psOut } = await execAsync("ps aux | grep -E 'claude$' | grep -v grep || true");
const lines = psOut.trim().split("\n").filter(Boolean);

// Step 2: Filter and get CWD for processes with active terminals only
const liveCwds = new Set<string>();
for (const line of lines) {
  const parts = line.trim().split(/\s+/);
  const pid = parts[1];
  const tty = parts[6];

  // ✅ Skip background sessions (TTY = ??)
  if (tty === "??") continue;

  // Get CWD only for terminal-attached processes
  const { stdout: lsofOut } = await execAsync(`lsof -p ${pid} 2>/dev/null | grep cwd || true`);
  // Extract and add CWD to liveCwds
}

// Step 3: Match sessions to live cwds (unchanged)
```

**Also updated UI filtering (packages/ui/src/hooks/useSessions.ts:12-33):**
```typescript
export function useSessions() {
  const db = getSessionsDbSync();

  const query = useLiveQuery(
    (q) =>
      q
        .from({ sessions: db.collections.sessions })
        .orderBy(({ sessions }) => sessions.lastActivityAt, "desc"),
    [db]
  );

  // ✅ Filter to only live sessions before grouping
  const allSessions: Session[] = query?.data
    ? Array.from(query.data.values())
    : [];

  const sessions = allSessions.filter((s) => s.isLive);

  return { sessions, isLoading: query?.isLoading ?? false };
}
```

This ensures:
1. Only processes with TTY (s000, s001, s002, etc.) are detected as live
2. Background sessions (TTY = `??`) are excluded
3. Repo grouping only sees live sessions, preventing empty groups

## Verification

After changes:
```bash
# Check live detection
ps aux | grep -E 'claude$' | grep -v grep | awk '$7 != "??" {print "LIVE:", $2, $7}'
# Output: Only 2 PIDs with active terminals

# UI shows:
# - 2 sessions marked as LIVE (correct)
# - 0 empty repo group headers (correct)
# - Background sessions not displayed (correct)
```

## Prevention

**Best practices for process detection:**
1. Use `ps aux` instead of `pgrep` when you need TTY information
2. Always filter background processes (TTY = `??`) for "active session" detection
3. Filter data at the query level (before grouping/aggregation) to prevent empty groups
4. Document detection logic in architecture docs for future reference

**Code locations to review:**
- `/packages/daemon/src/watcher.ts:459-501` - Live detection implementation
- `/packages/ui/src/hooks/useSessions.ts:12-33` - Session filtering
- `/docs/architecture/session-tracking-system.md` - Architecture documentation

**Test cases for future:**
- Verify background sessions (TTY = `??`) are NOT marked as live
- Verify terminal sessions (TTY = s000, s001, etc.) ARE marked as live
- Verify UI shows no empty repo groups after filtering
- Verify multiple sessions in same directory with different TTY status

## Related Files

- `/packages/daemon/src/watcher.ts` - Session detection and live status tracking
- `/packages/ui/src/hooks/useSessions.ts` - Client-side session filtering
- `/packages/ui/src/components/SessionTable.tsx` - Session display component
- `/docs/architecture/session-tracking-system.md` - Architecture documentation

## References

- Git commit: Updated live detection to exclude background sessions
- Architecture doc updated: Lines 216-269 (Working Approach section)
- Known limitation documented: Lines 298-316 (multiple sessions per directory)
