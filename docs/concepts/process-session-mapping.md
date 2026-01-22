# Process-Session Mapping Limitation

A fundamental constraint in the Claude Code UI session tracking system.

---

## The Constraint

**We cannot map a specific Claude process to a specific session file.**

This is not a bug or implementation gap - it's a fundamental limitation of the available signals.

---

## Why?

### What Claude Exposes

| Signal | Available? | How to Get |
|--------|-----------|------------|
| Process PID | ✓ | `pgrep -x claude` |
| Process CWD | ✓ | `lsof -p $pid \| grep cwd` |
| Process TTY | ✓ | `ps aux` column 7 |
| Session ID | ✗ | Not in cmdline, environ, or title |
| Session file path | ✗ | Not discoverable from process |

### What We Have

| Data Source | Contains |
|-------------|----------|
| JSONL files | Session ID, CWD, conversation history |
| Hook signals | Session ID, status flags |
| Process info | PID, CWD, TTY |

**Gap:** No link between process PID and session ID.

---

## Implications

### Multi-Session Directories

```
/project/
├── Session A (started 2 hours ago, closed)
├── Session B (started 1 hour ago, closed)
└── Session C (started 5 min ago, active)    ← 1 Claude process
```

**What we can determine:**
- A Claude process exists in `/project/`
- Sessions A, B, C all have `cwd: /project/`

**What we cannot determine:**
- Which session the process is writing to
- Whether A and B are truly "dead" or just idle

### Our Approach

Filter by **cwd presence** rather than **session-process mapping**:
- If ANY process runs in a cwd → show ALL sessions in that cwd
- If NO process runs in a cwd → hide ALL sessions in that cwd

**Result:** May show some "extra" sessions, but never hides active ones.

---

## Potential Solutions (Not Implemented)

### 1. Claude CLI Session ID in Process

If Claude exposed session ID:
```bash
claude --session-id=abc123 "prompt"
```

We could `ps aux | grep abc123` for exact matching.

**Status:** Would require Claude CLI changes.

### 2. Session File Lock

If Claude held an exclusive lock on its session file:
```bash
lsof ~/.claude/projects/encoded-dir/main.jsonl
```

Would show Claude PID, not daemon PID.

**Status:** Daemon's chokidar watching prevents this approach.

### 3. IPC / Socket

Claude could create a socket or PID file:
```
~/.claude/sessions/abc123.pid  # Contains PID
```

**Status:** Would require Claude CLI changes.

---

## Design Decision

Given the constraint, we chose **filtering over precision**:

| Approach | Pros | Cons |
|----------|------|------|
| Show all sessions | Complete information | Overwhelming (50+ sessions) |
| Show only exact matches | Perfect precision | Impossible without CLI changes |
| **Filter by cwd presence** | Good noise reduction | May show few extra per directory |

The tradeoff is acceptable because:
1. Most directories have 1 active session
2. Showing 3 sessions in a hot directory beats showing 50 dead ones
3. False negatives (hiding active sessions) would be worse than false positives
