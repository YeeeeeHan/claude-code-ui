# Session Filtering by Process Detection

**Date:** 2026-01-22
**Problem:** UI shows 50+ stale sessions, creating noise and making it hard to find active work
**Solution:** Filter sessions to only show those with a running Claude process

---

## The Problem

The daemon watches `~/.claude/projects/` for JSONL session files. Over time, sessions accumulate:
- User starts Claude, works, closes terminal
- JSONL file persists forever
- UI shows all historical sessions

Result: 56 sessions displayed when only 2-3 are actually running.

---

## Key Insight: Process → Session Mapping is Impossible

We **cannot** definitively map a Claude process to a specific session file because:

| What We Know | What We Don't Know |
|--------------|-------------------|
| Claude process PIDs (`pgrep -x claude`) | Which session file a process is writing to |
| Process working directories (`lsof -p $pid \| grep cwd`) | Session ID from process cmdline/environ |
| Session file paths and cwds | Which process owns which session |

**Why?**
1. Claude CLI doesn't expose session ID in process title or cmdline
2. The daemon opens all JSONL files for watching, so `lsof` on a session file shows the daemon PID, not Claude
3. Multiple sessions can share the same `cwd`

---

## The Solution: Filter by CWD Presence

Since we can't map process → session, we filter by **directory presence**:

```
IF any Claude process is running in session.cwd
THEN show the session
ELSE hide the session
```

### Algorithm

```bash
# 1. Get all Claude PIDs (foreground + background)
pgrep -x claude

# 2. For each PID, get working directory
lsof -p $pid 2>/dev/null | grep cwd | awk '{print $NF}'

# 3. Collect into activeCwds Set
# 4. Mark sessions: hasProcess = activeCwds.has(session.cwd)
# 5. Filter UI to only show hasProcess === true
```

### Implementation

**Daemon** (`watcher.ts`):
- `detectActiveCwds()` - Returns `Set<string>` of directories with Claude processes
- `updateProcessStatus()` - Updates `hasProcess` field on sessions every 10 seconds
- No TTY filtering - includes both foreground and background processes

**UI** (`useSessions.ts`):
- `groupSessionsByRepo()` filters by `hasProcess` before grouping
- Empty repo groups are excluded entirely

---

## Tradeoffs

### What This Achieves
- Reduces 56 sessions → ~5 active ones
- Hides completely dead sessions (no process at all)
- Shows relevant work in progress

### Known Limitation: Multiple Sessions Per Directory

If you have:
- 3 old sessions in `/project`
- 1 active Claude process in `/project`

**Result:** All 4 sessions show (we can't tell which is the "real" one)

**Mitigation:** This is acceptable because:
1. Usually only 1 session per directory is active at a time
2. Showing a few extra sessions in a "hot" directory is better than showing 50 dead ones
3. The alternative (hiding legitimate sessions) would be worse

---

## Evolution: "Live" Concept Removal

### Original "LIVE" Badge Approach

Initially implemented a `LIVE` badge showing which sessions had running processes:
- Filtered to foreground-only (TTY ≠ `??`)
- Showed badge on sessions
- Created confusion: "working" session without LIVE badge?

### Why It Was Confusing

| Session State | Has Process? | Badge | User Expectation |
|--------------|--------------|-------|------------------|
| working | Yes | LIVE | ✓ Makes sense |
| working | No (stale) | - | "Why is it working but not LIVE?" |
| waiting | Yes | LIVE | "Why LIVE if Claude is waiting?" |
| idle | No | - | ✓ Makes sense |

The "LIVE" concept conflated:
- **Status** (what Claude is doing) - working/waiting/idle
- **Process existence** (is Claude running) - yes/no

### Current Approach: Silent Filtering

Instead of showing a badge, we simply **hide** sessions without processes:
- No cognitive overhead interpreting badges
- If you see it, a process exists
- Clean separation: status = what Claude is doing, visibility = is process running

---

## Code References

| File | Function | Purpose |
|------|----------|---------|
| `watcher.ts` | `detectActiveCwds()` | Get cwds with Claude processes |
| `watcher.ts` | `updateProcessStatus()` | Update `hasProcess` on sessions |
| `schema.ts` | `hasProcess: z.boolean()` | Schema field |
| `useSessions.ts` | `groupSessionsByRepo()` | Filter by `hasProcess` before grouping |
| `index.tsx` | Empty state | Show "No active sessions" when all filtered |

---

## Future Considerations

### If Claude CLI Exposed Session ID

If Claude CLI exposed session ID in process cmdline:
```bash
# Hypothetical
claude --session-id=abc123 "my prompt"
ps aux | grep abc123  # → exact match
```

We could then:
1. Map processes to specific sessions
2. Accurately show which session is "alive" in multi-session directories
3. Distinguish orphaned sessions from active ones

### Alternative: JSONL Modification Time

Could use file modification time as a proxy:
- If JSONL modified in last N seconds → session is active
- Combined with process detection for higher confidence

Not implemented because current approach is "good enough" for the use case.
