# Sessions Filtered to Only Show Live - Most Sessions Hidden

---
title: "Sessions filtered to only show live sessions, displaying just 1 of 17"
problem_type: ui-bugs
component: packages/ui/src/hooks/useSessions.ts
related_files:
  - packages/ui/src/hooks/useSessions.ts
  - packages/daemon/src/watcher.ts
symptoms:
  - "Only 1 session showing when 17 exist"
  - "Multiple Claude processes running but UI shows single session"
  - "Sessions disappear from UI despite existing in daemon"
tags:
  - session-tracking
  - live-detection
  - filtering
  - data-visibility
date_discovered: 2026-01-22
severity: high
---

## Problem

The claude-code-ui frontend was only showing **1 session** for a repository when there were actually **17 sessions** in the session files and **3 running Claude processes**.

### Symptoms

- UI showed "1 session" for KyleAMathews/claude-code-ui
- Running `ps aux | grep claude` showed 3 processes in that directory
- Session files in `~/.claude/projects/` showed 17 .jsonl files
- LIVE badge appeared on the single visible session

## Investigation

### Step 1: Check Running Processes

```bash
ps aux | grep -E 'claude$' | grep -v grep
```

Found 7 Claude processes total, 3 in the claude-code-ui directory (PIDs: 77435, 52652, 39718).

### Step 2: Check Session Files

```bash
ls -la ~/.claude/projects/-Users-limyeehan-Documents-Code-side-hustle-useful-resources-claude-code-ui/
```

Found 17 .jsonl session files.

### Step 3: Check Daemon Stream

```bash
curl -s http://127.0.0.1:4450/sessions | jq -r '.[] | select(.value.isLive == true)'
```

Only 1 session marked as `isLive: true` for the directory.

### Step 4: Found the Filter

In `packages/ui/src/hooks/useSessions.ts` line 28:

```typescript
const sessions = allSessions.filter((s) => s.isLive);
```

## Root Cause

**Two design decisions combined to hide sessions:**

1. **UI Filter**: The `useSessions` hook filtered to only show sessions where `isLive === true`

2. **Daemon Live Detection**: The daemon only marks **one session per directory** as LIVE (the most recent by `lastActivityAt`) - this is documented as intentional behavior to avoid false positives when multiple sessions share a directory.

**Result**: Even with 17 sessions and 3 running processes, only 1 session appeared in the UI.

## Solution

Removed the live filter to show all sessions:

### Before (Broken)

```typescript
// Transform to array of sessions and filter to only live sessions
const allSessions: Session[] = query?.data
  ? Array.from(query.data.values())
  : [];

const sessions = allSessions.filter((s) => s.isLive);
```

### After (Fixed)

```typescript
// Transform to array of sessions (show all, not just live)
const sessions: Session[] = query?.data
  ? Array.from(query.data.values())
  : [];
```

**Result**: UI now shows all 18 sessions instead of just 1. The LIVE badge still displays on sessions marked as live by the daemon.

## Prevention

### 1. Default to Showing All Data (Opt-In Filtering)

Filtering should always be opt-in, not opt-out. Users should see everything by default.

```typescript
// BAD: Hidden filter
const sessions = allSessions.filter((s) => s.isLive);

// GOOD: No filtering by default
const sessions = allSessions;

// GOOD: Explicit filter option
export function useSessions(options?: { filterLive?: boolean }) {
  const sessions = query?.data ? Array.from(query.data.values()) : [];
  if (options?.filterLive) {
    return sessions.filter(s => s.isLive);
  }
  return sessions;
}
```

### 2. Consider Adding UI Toggle

Rather than hardcoding filter behavior, add a user-visible toggle:

```tsx
<Flex align="center" gap="2">
  <Text size="1" color="gray">Show only live</Text>
  <Switch
    checked={showOnlyLive}
    onCheckedChange={setShowOnlyLive}
  />
</Flex>
```

### 3. Name Functions to Reflect Filtering

```typescript
// BAD: Name doesn't indicate filtering
function useSessions() { /* filters to live only */ }

// GOOD: Name indicates filtering
function useLiveSessions() { /* filters to live only */ }
function useAllSessions() { /* no filtering */ }
```

## Related Documentation

- [Session Tracking System Architecture](../../architecture/session-tracking-system.md) - explains live detection logic
- [Multiple Sessions Showing Live Fix](./multiple-sessions-showing-live-20260122.md) - related daemon-side fix
- [Background Sessions Marked Live Fix](../logic-errors/background-sessions-marked-live-20260122.md) - TTY filtering fix

## Code References

| File | Description |
|------|-------------|
| `packages/ui/src/hooks/useSessions.ts:23-28` | Session filtering (fixed) |
| `packages/daemon/src/watcher.ts:459-501` | `detectLiveSessions()` - marks one per directory |
| `packages/daemon/src/watcher.ts:500-520` | Most recent session per cwd logic |
