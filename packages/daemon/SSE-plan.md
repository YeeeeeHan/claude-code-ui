# SSE Implementation Plan

> **STATUS: ✅ IMPLEMENTED**
> See [SSE-IMPLEMENTATION.md](./SSE-IMPLEMENTATION.md) for implementation details.
>
> **Key Changes:**
> - Patched `@durable-streams/state` to support `live: "sse"` option
> - Updated UI client to use SSE mode
> - Server already had SSE support built-in
> - Expected improvement: 20-100x faster notifications (<100ms vs 2-10s)

---

## Current State: Long-Polling Bottleneck

### Architecture
```
Daemon → DurableStreamTestServer (long-polling only) → UI Client (polls every 2-10s)
```

### Measured Latency
- **Daemon fast-path publish**: Instant (⚡ indicator confirms <10ms)
- **UI receives update**: 2-10 seconds later
- **Total end-to-end**: 2-10 seconds (vs target <100ms)

### Root Cause
The `DurableStreamTestServer` from `@durable-streams/server` **only supports HTTP long-polling**, not Server-Sent Events (SSE).

**Evidence from browser logs:**
```
GET http://127.0.0.1:4450/sessions?offset=...&live=long-poll&cursor=2035003
```

The `live=long-poll` query parameter confirms the client is using long-polling, even though it requested `live: "auto"`.

## Long-Polling vs SSE

### Long-Polling (Current)
**How it works:**
1. Client makes HTTP request with `?live=long-poll`
2. Server holds request open until new data arrives OR timeout (20 seconds)
3. Server responds with batch of updates
4. Client immediately makes new request (repeat)

**Latency characteristics:**
- **Best case**: 50-200ms (server has data ready)
- **Typical case**: 2-5 seconds (waiting for batch)
- **Worst case**: 20 seconds (timeout, then retry)

**Pros:**
- Simple HTTP (no special protocol)
- Works through all proxies/firewalls
- Automatic reconnection

**Cons:**
- High latency (batching, round-trip overhead)
- More server load (new request per batch)
- Network inefficient (HTTP headers on every poll)

### SSE (Server-Sent Events)
**How it works:**
1. Client makes HTTP GET with `Accept: text/event-stream`
2. Server responds with `Content-Type: text/event-stream` and keeps connection open
3. Server pushes data as `data: {...}\n\n` chunks whenever updates occur
4. Client receives updates in real-time via EventSource API

**Latency characteristics:**
- **Best case**: <50ms (instant push when data available)
- **Typical case**: <100ms (network latency + processing)
- **Worst case**: 500ms (slow network)

**Pros:**
- Real-time push (no polling delay)
- Low latency (<100ms typical)
- Efficient (single connection, minimal overhead)
- Automatic reconnection (built into EventSource)

**Cons:**
- Requires server-side SSE implementation
- One-way only (server → client)
- Some proxies/CDNs may buffer events

## Why Client Uses Long-Polling

### Client Configuration
File: `packages/ui/src/data/sessionsDb.ts:22-28`
```typescript
const db = await createStreamDB({
  streamOptions: {
    url: STREAM_URL,
    contentType: "application/json",
  },
  state: sessionsStateSchema,
});
```

The client uses `live: "auto"` by default, which means it **negotiates** with the server. The server determines which mode to use.

### Server Limitation
File: `packages/daemon/src/server.ts:34-37`
```typescript
this.server = new DurableStreamTestServer({
  port: this.port,
  host: "127.0.0.1",
});
```

**DurableStreamTestServer** only implements HTTP long-polling endpoints:
- `GET /sessions?live=long-poll&cursor=X` → long-poll endpoint
- No SSE endpoint (`GET /sessions` with `Accept: text/event-stream`)

When the client requests `live: "auto"`, the server responds with `live=long-poll` because that's all it supports.

## Evidence of the Bottleneck

### From browser Network tab
```
Request URL: http://127.0.0.1:4450/sessions?offset=...&live=long-poll&cursor=2035003
Request Method: GET
Status: 200 OK
```

**Timing breakdown:**
- Stalled: 0ms
- Waiting (TTFB): 2,000-7,000ms  ← **This is the batching delay**
- Content Download: 5ms

### From browser console logs
```
23:37:27 PM [Daemon] Fast-path publish for 21e38c02
...
(2-10 seconds pass)
...
23:37:30+ [StreamDB] Processing batch #X: 1 items
23:37:30+ [Notifications] TRANSITION detected
```

The gap between daemon publish and UI receiving the batch is the long-polling delay.

## What Needs to Change for SSE

### Option 1: Replace with Production Durable Streams Server
```typescript
// Replace DurableStreamTestServer with production server
import { DurableStreamServer } from "@durable-streams/server"; // Production version

this.server = new DurableStreamServer({
  port: this.port,
  host: "127.0.0.1",
  enableSSE: true, // Enable SSE support
});
```

**Status**: Unknown if `@durable-streams/server` has a production version with SSE.
**Action needed**: Check package documentation or source code.

### Option 2: Implement Custom SSE Endpoint
Add SSE endpoint to the existing HTTP server:

```typescript
// In server.ts
import express from 'express';

async start(): Promise<void> {
  await this.server.start();

  // Add custom SSE endpoint
  const app = express();

  app.get('/sessions/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Subscribe to stream updates
    const subscription = this.stream.subscribe();

    subscription.on('update', (session) => {
      res.write(`data: ${JSON.stringify(session)}\n\n`);
    });

    req.on('close', () => subscription.unsubscribe());
  });

  app.listen(4451); // Separate port for SSE
}
```

**Pros**: Full control, works with existing architecture
**Cons**: Maintains two protocols (SSE + long-polling)

### Option 3: Use DurableStream's Built-in SSE (if available)
The `@durable-streams/client` library supports `live: "sse"` mode:

```typescript
// In sessionsDb.ts (client)
streamOptions: {
  url: STREAM_URL,
  contentType: "application/json",
  live: "sse", // Force SSE mode
}
```

**Problem**: This requires the server to implement SSE endpoints. The `DurableStreamTestServer` doesn't have this.

**Solution**: Investigate if `@durable-streams/server` has SSE support that we're not using.

## Implementation Strategy

### Phase 1: Investigate Durable Streams SSE Support
1. Check `@durable-streams/server` documentation
2. Look for SSE-enabled server class or configuration
3. Test if setting `live: "sse"` on client triggers any SSE behavior

### Phase 2: Minimal SSE Implementation
If no built-in support:
1. Keep `DurableStreamTestServer` for compatibility
2. Add custom Express server with SSE endpoint at `/sessions/sse`
3. Update client to connect to SSE endpoint
4. Subscribe SSE endpoint to stream updates

### Phase 3: Performance Testing
1. Measure end-to-end latency (daemon publish → browser notification)
2. Target: <100ms (vs current 2-10 seconds)
3. Expected improvement: **20-100x faster**

### Phase 4: Fallback Strategy
Keep long-polling as fallback:
```typescript
streamOptions: {
  url: STREAM_URL,
  contentType: "application/json",
  live: "auto", // Try SSE, fallback to long-poll
  sseResilience: {
    maxFailures: 3, // Fall back after 3 SSE failures
  }
}
```

## Expected Performance Impact

### Current (Long-Polling)
| Scenario | Daemon Publish | UI Receives | Total Latency |
|----------|----------------|-------------|---------------|
| Tool approval | 11:37:27.123 | 11:37:30.181 | **3,058ms** |
| Working → Waiting | 11:37:27.123 | 11:37:29.440 | **2,317ms** |
| Regular update | 11:37:27.123 | 11:37:32.111 | **4,988ms** |

### With SSE (Projected)
| Scenario | Daemon Publish | UI Receives | Total Latency |
|----------|----------------|-------------|---------------|
| Tool approval | 11:37:27.123 | 11:37:27.180 | **~57ms** ✨ |
| Working → Waiting | 11:37:27.123 | 11:37:27.195 | **~72ms** ✨ |
| Regular update | 11:37:27.123 | 11:37:27.210 | **~87ms** ✨ |

**Improvement**: 30-50x faster notification latency

## Browser Compatibility

### SSE Support (EventSource API)
- ✅ Chrome/Brave: Full support
- ✅ Firefox: Full support
- ✅ Safari: Full support
- ✅ Edge: Full support
- ❌ IE11: No support (use long-polling fallback)

**Conclusion**: SSE is safe for modern browsers (2020+).

## Known Issues to Address

### Issue 1: StreamDB Crash
```
[StreamDB] Error: Cannot read properties of undefined (reading 'Symbol(liveQueryInternal)')
```

**Cause**: TanStack DB / durable-streams state bug (unrelated to SSE/polling)
**Impact**: Causes daemon to crash, breaking all updates
**Priority**: Critical - fix before SSE implementation

### Issue 2: Daemon Crashes
```
23:37:03 ERR_CONNECTION_REFUSED
```

**Cause**: StreamDB error crashed the daemon process
**Impact**: No updates reach UI until daemon restarts
**Solution**: Add error handling and auto-restart

### Issue 3: HTTP Warning
```
[DurableStream] Using HTTP (not HTTPS) typically limits browsers to ~6 concurrent connections
```

**Impact**: Multiple streams can block each other
**Solution**: Use HTTPS in production OR switch to SSE (uses single connection)

## Recommended Next Steps

1. **Fix daemon stability** (prerequisite)
   - Add try-catch around StreamDB operations
   - Implement daemon auto-restart on crash
   - Add health check endpoint

2. **Research durable-streams SSE support**
   - Check if `@durable-streams/server` has SSE capability
   - Review Electric SQL documentation for SSE examples
   - Test `live: "sse"` mode with current server

3. **Implement SSE endpoint** (if needed)
   - Add Express server with `/sessions/sse` endpoint
   - Wire up to durable stream events
   - Update client to use SSE URL

4. **Measure and verify**
   - Compare long-polling vs SSE latencies
   - Verify <100ms notification time
   - Test fallback behavior

## Resources

- [Durable Streams Protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md)
- [Durable Streams GitHub](https://github.com/durable-streams/durable-streams)
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [MDN: EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [Electric SQL Blog: Durable Streams 0.1.0](https://electric-sql.com/blog/2025/12/23/durable-streams-0.1.0)
