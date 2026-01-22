# Session Tracking System Architecture

This document provides a comprehensive technical reference for the Claude Code UI session tracking system, based on exploration and debugging of the codebase.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Session Status State Machine](#session-status-state-machine)
3. [Git Repository Grouping](#git-repository-grouping)
4. [Data Flow](#data-flow)
5. [Known Limitations](#known-limitations)
6. [Code References](#code-references)

---

## Architecture Overview

The session tracking system monitors active Claude Code sessions and provides real-time status updates to the UI. The architecture consists of three main layers:

### 1. Daemon Layer (`packages/daemon`)
- Watches JSONL session files in `~/.claude/projects/`
- Watches signal files in `~/.claude/session-signals/`
- Derives session status using XState state machine
- Publishes session state to Durable Streams server

### 2. Server Layer (`packages/daemon/src/server.ts`)
- Runs a Durable Streams server on `http://127.0.0.1:4450`
- Provides real-time session updates to UI via `/sessions` endpoint
- Manages PR info caching and polling
- Coordinates AI summarization

### 3. UI Layer (`packages/ui`)
- Connects to Durable Streams server
- Uses TanStack StreamDB for reactive data
- Groups sessions by git repository
- Computes UI-level status (working/waiting/idle)

### Key Design Decisions

**Why XState for status detection?**
- Makes state transitions explicit and testable
- Replaces ad-hoc if-statements with formal state machine
- Easier to reason about edge cases (stale sessions, missing events)

**Why hook signals override JSONL-derived status?**
- Hooks are authoritative - they represent user actions in real-time
- JSONL files may have delays or missing events (especially `turn_duration`)
- Provides immediate feedback for user prompts and tool approvals

---

## Session Status State Machine

Status is determined by an XState state machine in `/packages/daemon/src/status-machine.ts`.

### States

The machine has 3 primary states:

| State | Description | UI Display |
|-------|-------------|------------|
| `working` | Claude is actively processing | "working" (yellow dot) |
| `waiting_for_approval` | Tool use needs user approval | "waiting" with pending tool (orange dot) |
| `waiting_for_input` | Claude finished, waiting for user | "waiting" (gray dot) |

**Note:** The "idle" status is computed client-side in the UI based on elapsed time (>1 hour since last activity).

### Events

Events are derived from JSONL log entries:

```typescript
type StatusEvent =
  | { type: "USER_PROMPT"; timestamp: string }
  | { type: "TOOL_RESULT"; timestamp: string; toolUseIds: string[] }
  | { type: "ASSISTANT_STREAMING"; timestamp: string }
  | { type: "ASSISTANT_TOOL_USE"; timestamp: string; toolUseIds: string[] }
  | { type: "TURN_END"; timestamp: string }
  | { type: "STALE_TIMEOUT" };
```

**Event Mapping from Log Entries:**
- `USER_PROMPT`: User message with string content or text blocks
- `TOOL_RESULT`: User message with `tool_result` content blocks
- `ASSISTANT_STREAMING`: Assistant message with no tool_use (or only auto-approved tools)
- `ASSISTANT_TOOL_USE`: Assistant message with tool_use blocks (excluding auto-approved tools)
- `TURN_END`: System message with `turn_duration` or `stop_hook_summary` subtype

**Auto-Approved Tools:** These tools don't trigger `ASSISTANT_TOOL_USE` events because they run automatically without user intervention:
- `Task` (subagents)
- `Read` (file reading)
- `Glob` (file pattern matching)
- `Grep` (content search)
- `TodoWrite` (todo list management)
- `TaskOutput` (getting task output)

### State Transitions

```
┌────────────────────┐
│ waiting_for_input  │ (initial state)
└────────┬───────────┘
         │ USER_PROMPT
         ▼
┌────────────────────┐
│     working        │
└─────┬──────┬───────┘
      │      │ ASSISTANT_TOOL_USE
      │      ▼
      │ ┌──────────────────────┐
      │ │ waiting_for_approval │
      │ └──────────┬───────────┘
      │            │ TOOL_RESULT
      │            ▼
      │      (back to working)
      │
      │ TURN_END
      ▼
┌────────────────────┐
│ waiting_for_input  │
└────────────────────┘
```

**Stale Timeout Logic:**
If a session is in `working` or `waiting_for_approval` state with no activity for >15 seconds, it transitions to `waiting_for_input`. This catches cases where the turn ends but no `turn_duration` event is written.

**Location:** `/packages/daemon/src/status-machine.ts:270-286`

```typescript
const STALE_TIMEOUT_MS = 15 * 1000; // 15 seconds

if (timeSinceActivity > STALE_TIMEOUT_MS) {
  if (stateValue === "working" && !context.hasPendingToolUse) {
    actor.send({ type: "STALE_TIMEOUT" });
  } else if (stateValue === "waiting_for_approval") {
    actor.send({ type: "STALE_TIMEOUT" });
  }
}
```

### Hook Signal Overrides

Hook signals from `~/.claude/session-signals/` **override** JSONL-derived status:

**Signal Priority (highest to lowest):**
1. **Session End Signal** (`<session_id>.ended.json`) → Forces status to "idle"
2. **Pending Permission** (`<session_id>.permission.json`) → Forces status to "waiting" with `hasPendingToolUse: true`
3. **Stop Signal** (`<session_id>.stop.json`) → Forces status to "waiting" (Claude's turn ended)
4. **Working Signal** (`<session_id>.working.json`) → Forces status to "working" (user started turn)
5. **JSONL-derived status** → Fallback if no hook signals present

**Location:** `/packages/daemon/src/watcher.ts:656-676`

```typescript
// Hook signals are authoritative - override JSONL-derived status
if (hasEndedSig) {
  status = { ...status, status: "idle", hasPendingToolUse: false };
} else if (pendingPermission) {
  status = { ...status, status: "waiting", hasPendingToolUse: true };
} else if (hasStopSig) {
  status = { ...status, status: "waiting", hasPendingToolUse: false };
} else if (hasWorkingSig) {
  status = { ...status, status: "working", hasPendingToolUse: false };
}
```

### UI Idle Detection

The UI computes "idle" status separately based on elapsed time:

**Location:** `/packages/ui/src/components/SessionTable.tsx:23-37`

```typescript
function getEffectiveStatus(session: Session): EffectiveStatus {
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
  const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();

  if (elapsed > IDLE_TIMEOUT_MS) {
    return "idle";
  }
  if (session.status === "working") {
    return "working";
  }
  if (session.status === "waiting" && session.hasPendingToolUse) {
    return "approval";
  }
  return "waiting";
}
```

## Git Repository Grouping

Sessions are grouped by GitHub repository for display in the UI.

### Git Info Extraction

Git info is extracted by parsing `.git/config` and `.git/HEAD` files:

**Location:** `/packages/daemon/src/git.ts`

**Algorithm:**
1. Walk up directory tree from `session.cwd` to find `.git` directory
2. Read `.git/config` to extract `origin` remote URL
3. Parse URL to extract owner/repo (handles both HTTPS and SSH formats)
4. Read `.git/HEAD` to extract current branch name

**URL Parsing with Bug Fix:**

The original regex didn't handle URLs with extra slashes (e.g., `https://github.com//owner/repo`). This was fixed by adding `/+` to match one or more slashes.

**Location:** `/packages/daemon/src/git.ts:38-49`

```typescript
function parseGitUrl(url: string): { repoUrl: string; repoId: string } | null {
  // HTTPS format: https://github.com/owner/repo.git (also handles extra slashes)
  const httpsMatch = url.match(
    /^https?:\/\/(?:www\.)?github\.com\/+([^/]+)\/([^/\s]+?)(?:\.git)?$/i
  );
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch;
    return {
      repoUrl: `https://github.com/${owner}/${repo}`,
      repoId: `${owner}/${repo}`,
    };
  }
  // ... SSH format handling
}
```

**Bug:** The regex previously was:
```typescript
/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/i
```

This failed for URLs like `git@github.com:/owner/repo` (extra slash after colon).

**Fix:** Changed to `/+` and `:\/?` to handle multiple slashes:

**Location:** `/packages/daemon/src/git.ts:52-54`

```typescript
// SSH format: git@github.com:owner/repo.git (also handles git@github.com:/owner/repo)
const sshMatch = url.match(
  /^git@github\.com:\/?([^/]+)\/([^/\s]+?)(?:\.git)?$/i
);
```

### Repo Grouping in UI

Sessions are grouped by `gitRepoId` (format: `owner/repo`):

**Location:** `/packages/ui/src/hooks/useSessions.ts:74-94`

```typescript
export function groupSessionsByRepo(sessions: Session[]): RepoGroup[] {
  const groups = new Map<string, Session[]>();

  for (const session of sessions) {
    const key = session.gitRepoId ?? "Other";
    const existing = groups.get(key) ?? [];
    existing.push(session);
    groups.set(key, existing);
  }

  const groupsWithScores = Array.from(groups.entries()).map(([key, sessions]) => ({
    repoId: key,
    repoUrl: key === "Other" ? null : `https://github.com/${key}`,
    sessions,
    activityScore: calculateRepoActivityScore(sessions),
  }));

  groupsWithScores.sort((a, b) => b.activityScore - a.activityScore);

  return groupsWithScores;
}
```

**Activity Score:** Groups are sorted by activity score, which considers:
- Session status (working=100, waiting=50, idle=1)
- Pending tool bonus (+30 points)
- Time decay (half-life of 30 minutes)

**Location:** `/packages/ui/src/hooks/useSessions.ts:47-62`

```typescript
function calculateRepoActivityScore(sessions: Session[]): number {
  const now = Date.now();

  return sessions.reduce((score, session) => {
    const ageMs = now - new Date(session.lastActivityAt).getTime();
    const ageMinutes = ageMs / (1000 * 60);

    let sessionScore = STATUS_WEIGHTS[session.status];
    if (session.hasPendingToolUse) {
      sessionScore += PENDING_TOOL_BONUS;
    }

    const decayFactor = Math.pow(0.5, ageMinutes / 30);
    return score + sessionScore * decayFactor;
  }, 0);
}
```

---

## Data Flow

### End-to-End Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Claude CLI writes to session JSONL + signal files       │
│    ~/.claude/projects/<encoded-dir>/main.jsonl              │
│    ~/.claude/session-signals/<session-id>.*.json            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SessionWatcher (chokidar) detects file changes          │
│    /packages/daemon/src/watcher.ts                          │
│    - Watches JSONL files for new entries                    │
│    - Watches signal files for hook events                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Status Derivation                                        │
│    /packages/daemon/src/status-machine.ts                   │
│    - Run log entries through XState machine                 │
│    - Override with hook signals if present                  │
│    - Detect stale sessions (15s timeout)                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Git Info Lookup (cached)                                 │
│    /packages/daemon/src/git.ts                              │
│    - Parse .git/config for remote URL                       │
│    - Parse .git/HEAD for branch name                        │
│    - Extract owner/repo from URL                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. StreamServer publishes to Durable Streams               │
│    /packages/daemon/src/server.ts                           │
│    - Convert SessionState to Session schema                 │
│    - Generate AI goal + summary (cached/periodic)           │
│    - Queue PR check for branch (if exists)                  │
│    - Publish insert/update/delete events                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. UI receives updates via Durable Streams                  │
│    http://127.0.0.1:4450/sessions                           │
│    /packages/ui/src/data/sessionsDb.ts                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. TanStack StreamDB + useLiveQuery                         │
│    /packages/ui/src/hooks/useSessions.ts                    │
│    - Reactive query on sessions collection                  │
│    - Auto-updates when stream receives events               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. UI Components render sessions                            │
│    /packages/ui/src/components/SessionTable.tsx             │
│    - Compute effective status (working/approval/waiting/idle)│
│    - Group by repo, sort by activity score                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Responsibility | Update Frequency |
|-----------|---------------|------------------|
| `SessionWatcher` | Watch session files and signals | Real-time (chokidar events) |
| `status-machine.ts` | Derive status from log entries | On every new JSONL entry |
| `getGitInfoCached()` | Extract repo + branch from .git | Cached (1 minute TTL) |
| `StreamServer` | Publish session state to stream | On session create/update/delete |
| `useLiveQuery()` | Query sessions from StreamDB | Real-time (stream updates) |
| `getEffectiveStatus()` | Compute UI status with idle detection | On every render |

---

## Known Limitations

### 1. Daemon File Locking

**Problem:** The daemon opens all session files via `chokidar` for watching, so `lsof <session-file>` always returns the daemon PID.

**Impact:** Cannot use file handle inspection to determine which process has a session open.

**Solution:** Use process working directory matching instead (current implementation).

### 2. Missing turn_duration Events

**Problem:** Sometimes Claude finishes a turn but doesn't write a `turn_duration` system event to the JSONL file.

**Impact:** Sessions stay in "working" state indefinitely.

**Solution:** Stale timeout after 15 seconds of no activity transitions "working" → "waiting_for_input".

**Location:** `/packages/daemon/src/status-machine.ts:274-286`

### 3. Branch Change Detection Delay

**Problem:** Branch changes are detected via git cache refresh (1 minute TTL).

**Impact:** Up to 1 minute delay before UI reflects branch change.

**Solution:** Could implement filesystem watching on `.git/HEAD` for instant detection.

### 4. Non-GitHub Repositories

**Problem:** Git URL parsing only supports GitHub (HTTPS and SSH formats).

**Impact:** Sessions in GitLab, Bitbucket, or private Git servers won't have `gitRepoId` extracted.

**Solution:** Could extend `parseGitUrl()` to support other providers.

---

## Code References

### Core Status Detection

| File | Lines | Description |
|------|-------|-------------|
| `/packages/daemon/src/status-machine.ts` | 1-324 | XState state machine for status detection |
| `/packages/daemon/src/status.ts` | 1-71 | Status derivation entry point |
| `/packages/daemon/src/watcher.ts` | 656-676 | Hook signal override logic |

### Git Repository Grouping

| File | Lines | Description |
|------|-------|-------------|
| `/packages/daemon/src/git.ts` | 38-65 | `parseGitUrl()` - extract owner/repo from URL |
| `/packages/daemon/src/git.ts` | 128-158 | `getGitInfo()` - read .git files |
| `/packages/daemon/src/git.ts` | 175-202 | `getGitInfoCached()` - caching layer |

### Data Publishing

| File | Lines | Description |
|------|-------|-------------|
| `/packages/daemon/src/server.ts` | 86-156 | `publishSession()` - convert state to schema |
| `/packages/daemon/src/server.ts` | 196-315 | Helper functions for session data extraction |

### UI Components

| File | Lines | Description |
|------|-------|-------------|
| `/packages/ui/src/hooks/useSessions.ts` | 12-33 | `useSessions()` - reactive session query |
| `/packages/ui/src/hooks/useSessions.ts` | 74-94 | `groupSessionsByRepo()` - group by git repo |
| `/packages/ui/src/components/SessionTable.tsx` | 23-37 | `getEffectiveStatus()` - UI idle detection |

### Schema Definitions

| File | Lines | Description |
|------|-------|-------------|
| `/packages/daemon/src/schema.ts` | 1-70 | Zod schemas for Session, PRInfo, etc. |
| `/packages/daemon/src/types.ts` | - | Internal daemon types (LogEntry, StatusResult) |

---

## Debugging Tips

### Check if session file is being watched

```bash
# See what the daemon is watching
lsof -p $(pgrep -x "node.*daemon") | grep projects
```

### Check hook signals

```bash
# List active signals
ls -la ~/.claude/session-signals/

# View a specific signal
cat ~/.claude/session-signals/<session-id>.permission.json
```

### Manually derive status from JSONL

```bash
# Read session file
tail -f ~/.claude/projects/<encoded-dir>/main.jsonl | jq .

# Check for turn_duration events
grep -c turn_duration ~/.claude/projects/<encoded-dir>/main.jsonl
```

### Check Durable Streams connection

```bash
# Test if server is running
curl http://127.0.0.1:4450/sessions

# Watch stream updates (requires stream client)
# Use browser DevTools Network tab when UI is open
```

### Force git cache refresh

```typescript
// In daemon code
import { clearGitCache } from "./git.js";
clearGitCache("/path/to/session/cwd");
```

---

## Future Improvements

### 1. Filesystem Watching for Branch Changes

Instead of polling git info every minute, watch `.git/HEAD`:

```typescript
watch(`${gitDir}/HEAD`, { persistent: true })
  .on("change", () => {
    // Invalidate cache and refresh branch
    clearGitCache(sessionCwd);
  });
```

### 2. Support Non-GitHub Remotes

Extend `parseGitUrl()` to handle GitLab, Bitbucket, etc:

```typescript
// GitLab: https://gitlab.com/owner/repo
const gitlabMatch = url.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/\s]+)/);
```

### 3. WebSocket for Real-Time Updates

Durable Streams provides real-time updates, but adding WebSocket pings could reduce latency for status changes:

```typescript
// Daemon sends immediate WS message on status change
// UI receives update instantly, before stream propagates
```

---

## Summary

The session tracking system is a multi-layered architecture that:

1. **Watches** session JSONL files and hook signal files via `chokidar`
2. **Derives** status using an XState state machine with hook signal overrides
3. **Groups** sessions by GitHub repository via git URL parsing
4. **Publishes** state to a Durable Streams server for real-time UI updates
5. **Displays** sessions with computed effective status (working/approval/waiting/idle)

Key design decisions prioritize:
- **Accuracy:** Hook signals override JSONL-derived status for immediate feedback
- **Resilience:** Stale timeouts handle missing events
- **Performance:** Caching for git info, debouncing for file changes

Known limitations exist around branch change detection delay, but the system is robust for typical workflows.
