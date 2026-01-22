# SSE Verification Guide

## Quick Start

To verify that Server-Sent Events (SSE) is working:

1. **Start the services:**
   ```bash
   pnpm start
   ```

2. **Open the UI** in your browser (usually `http://localhost:5173`)

3. **Verify SSE is active:**

### Method 1: Browser Network Tab

1. Open DevTools (F12)
2. Go to **Network** tab
3. Filter by "sessions" or "Fetch/XHR"
4. Look for a request to `/sessions`

**Expected (SSE working):**
- Request URL: `http://127.0.0.1:4450/sessions?offset=...&live=sse`
- Type: `EventStream` or shows as streaming
- Connection stays open (no completion time)
- Status: `200 OK` (ongoing)

**Before (long-polling):**
- Request URL: `http://127.0.0.1:4450/sessions?offset=...&live=long-poll`
- Type: `fetch` or `xhr`
- Multiple short requests every 2-10 seconds

### Method 2: Browser Console

Check for these log messages:

```javascript
// At startup
[StreamDB] Processing batch #1: X items, upToDate=true
[StreamDB] Marking up-to-date after batch #1

// On updates (should appear instantly)
[StreamDB] Processing batch #2: 1 items, upToDate=false
```

### Method 3: Latency Test

1. Create a new Claude session (or interact with an existing one)
2. Watch daemon console for:
   ```
   [Server] Fast-path publish for <session-id>
   ```
3. Watch browser console - you should see update within **~50-100ms**:
   ```
   [StreamDB] Processing batch #X: 1 items
   ```

**Expected latency:**
- ✅ SSE: <100ms (typically 50-80ms)
- ❌ Long-polling: 2-10 seconds

## Troubleshooting

### SSE Not Working

If you see long-polling instead of SSE:

1. **Check patch is applied:**
   ```bash
   cat patches/@durable-streams__state@0.1.5.patch
   ```
   Should show the SSE modifications.

2. **Check client configuration:**
   ```typescript
   // In packages/ui/src/data/sessionsDb.ts
   streamOptions: {
     contentType: "application/json",  // Tells server to send JSON
     live: "sse",  // Enable SSE mode
     json: true,  // Required: hint that SSE data is JSON
     sseResilience: { ... }
   }
   ```

3. **Reinstall dependencies:**
   ```bash
   pnpm install
   ```

### SSE Falls Back to Long-Polling

Check console for warnings:

```
[DurableStream] SSE connection too short (< 1000ms), retrying...
[DurableStream] Falling back to long-polling after 3 short connections
```

**Common causes:**
- Proxy buffering SSE responses
- Network firewall blocking streaming
- Server not responding correctly

**Solutions:**
- Check if behind a proxy
- Verify server is running (`pnpm serve`)
- Check firewall settings

### Verify Patch Applied

```bash
# Check patched file exists
ls -la node_modules/.pnpm/@durable-streams+state@0.1.5*/node_modules/@durable-streams/state/dist/index.js

# Verify live option is passed through (should see options.streamOptions.live)
grep -A 3 "startConsumer = async" node_modules/.pnpm/@durable-streams+state@0.1.5*/node_modules/@durable-streams/state/dist/index.js
```

Expected output:
```javascript
const startConsumer = async () => {
  if (consumerStarted) return;
  consumerStarted = true;
  streamResponse = await stream.stream({
    live: options.streamOptions.live ?? `auto`,  // ✅ Should pass through live option
    sseResilience: options.streamOptions.sseResilience,
    signal: abortController.signal
  });
```

## Performance Comparison

| Metric | Long-Polling (Before) | SSE (After) |
|--------|----------------------|-------------|
| **Update Latency** | 2-10 seconds | <100ms |
| **Network Requests** | New request every poll | Single persistent connection |
| **Server Load** | High (constant polling) | Low (push when needed) |
| **Browser Efficiency** | Multiple connections | Single EventStream |

## Success Indicators

You'll know SSE is working when you see:

1. ✅ Network tab shows `EventStream` type request
2. ✅ Single long-lived `/sessions` connection
3. ✅ Updates appear within 100ms
4. ✅ No repeated short requests
5. ✅ Console shows "live=sse" in request URL

## Implementation Details

See [SSE-IMPLEMENTATION.md](packages/daemon/SSE-IMPLEMENTATION.md) for technical details.
