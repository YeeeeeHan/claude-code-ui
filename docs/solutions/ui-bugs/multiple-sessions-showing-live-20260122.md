---
title: "Multiple sessions showing LIVE when only one terminal running"
category: ui-bugs
component: daemon/watcher
date_fixed: 2026-01-22
symptoms:
  - "25+ sessions displaying LIVE badge when only 1-2 terminal sessions are running"
  - "All historical sessions in a directory marked LIVE instead of just the active one"
  - "LIVE badge appearing on old/stale sessions that are not actually active"
tags:
  - session-tracking
  - live-detection
  - process-matching
  - cwd-matching
root_cause: "detectLiveSessions() matched ALL sessions with a cwd to any live process cwd, rather than only the most recent session per directory"
affected_file: "packages/daemon/src/watcher.ts"
affected_lines: "500-520"
related_docs:
  - docs/architecture/session-tracking-system.md
  - docs/solutions/logic-errors/background-sessions-marked-live-20260122.md
---

# Multiple Sessions Showing LIVE When Only One Terminal Running

## Problem Summary

Live session detection in Claude Code UI marked ALL sessions in a directory as LIVE when any Claude process ran there, causing significant noise (25 LIVE badges when only 2 actual sessions were running).

## Symptoms

- User has 2 actual Claude terminal sessions running
- UI displays 25+ sessions with LIVE badge
- All historical sessions in the same directories show as LIVE
- Makes it impossible to identify which sessions are actually active

## Root Cause

The original implementation in `packages/daemon/src/watcher.ts` used a simple set-based matching approach that marked **every** session whose `cwd` matched a live process's working directory as LIVE.

This was incorrect because:
1. Multiple historical sessions can share the same working directory (users run Claude multiple times in the same project)
2. Only **one** Claude process can be actively running per directory at a time
3. The old logic didn't distinguish between the current active session and older archived sessions in the same directory

### Before (lines 500-505)

```typescript
// Step 3: Match sessions to live cwds
for (const session of this.sessions.values()) {
  if (liveCwds.has(session.cwd)) {
    liveSessionIds.add(session.sessionId);
  }
}
```

**Problem:** This adds ALL sessions that match a live cwd to `liveSessionIds`, regardless of how many sessions exist for that directory.

## Solution

Changed to only mark the **MOST RECENT** session per cwd as LIVE by comparing `lastActivityAt` timestamps:

```typescript
// Step 3: Match sessions to live cwds
// Only mark the MOST RECENT session per cwd as LIVE to reduce noise
// (older sessions in the same directory are not the active one)
const mostRecentByCwd = new Map<string, { sessionId: string; lastActivityAt: string }>();

for (const session of this.sessions.values()) {
  if (liveCwds.has(session.cwd)) {
    const existing = mostRecentByCwd.get(session.cwd);
    const sessionActivity = session.status.lastActivityAt;
    if (!existing || new Date(sessionActivity) > new Date(existing.lastActivityAt)) {
      mostRecentByCwd.set(session.cwd, {
        sessionId: session.sessionId,
        lastActivityAt: sessionActivity,
      });
    }
  }
}

for (const { sessionId } of mostRecentByCwd.values()) {
  liveSessionIds.add(sessionId);
}
```

### Algorithm Explanation

1. **Create a tracking Map** keyed by `cwd` that stores the session ID and last activity timestamp
2. **Iterate through all sessions** that match a live cwd
3. **Compare timestamps** - if this session's `lastActivityAt` is more recent than the currently tracked session for that cwd, replace it
4. **After processing all sessions**, only the most recent session per cwd remains in the Map
5. **Add only those session IDs** to the `liveSessionIds` set

## Debugging Steps

1. **Check running Claude processes:**
   ```bash
   ps aux | grep -E 'claude$' | grep -v grep
   ```
   Found 3 processes: 2 with terminals (s001, s003), 1 background (??)

2. **Get process working directories:**
   ```bash
   lsof -p <pid> 2>/dev/null | grep cwd
   ```
   Verified cwds: `/Users/.../claude-code-ui` and `/Users/.../dotfiles`

3. **Check daemon session data:**
   ```bash
   curl -s http://127.0.0.1:4450/sessions | jq '.[] | select(.value.isLive == true)'
   ```
   Found ALL sessions in matching directories were marked LIVE

4. **Identify the bug:**
   The matching logic was too broad - it matched all sessions to a cwd rather than just the most recent one

## Verification

1. **Start multiple Claude sessions in the same directory** over time
2. **Check the UI** - should show only 1 LIVE badge per directory with an active process
3. **Verify with `ps aux | grep claude`** - count of LIVE badges should match count of running terminal processes
4. **Stop a Claude process** - the LIVE badge should disappear for that session

## Impact

- **Before:** 25 LIVE badges displayed when only 2 processes running (false positives)
- **After:** LIVE badges accurately reflect the number of running Claude processes (2 badges for 2 processes)

## Prevention

### Design Review Questions

When implementing process-to-entity matching, ask:
1. **Uniqueness**: Is the matching key (cwd) unique, or can multiple entities share it?
2. **State filtering**: Are all detected processes truly "active"?
3. **Temporal consideration**: If multiple matches exist, which is the "correct" one?

### Test Cases

```typescript
it("should only mark the MOST RECENT session as live when multiple sessions share cwd", async () => {
  const oldSession = createSession({
    cwd: "/shared/project",
    lastActivityAt: "2026-01-22T10:00:00Z"
  });
  const newSession = createSession({
    cwd: "/shared/project",
    lastActivityAt: "2026-01-22T11:00:00Z"
  });

  const liveIds = await watcher.detectLiveSessions();

  expect(liveIds.has(newSession.sessionId)).toBe(true);
  expect(liveIds.has(oldSession.sessionId)).toBe(false);
});
```

## Related Issues

- Background sessions marked as live (TTY filter) - see `docs/solutions/logic-errors/background-sessions-marked-live-20260122.md`
- Known limitation: Multiple Sessions Per Directory - see `docs/architecture/session-tracking-system.md#known-limitations`
