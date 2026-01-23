#!/usr/bin/env node
/**
 * Starts the session watcher and durable streams server.
 * Sessions are published to the stream for the UI to consume.
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

// Load .env from project root (handles both src and dist execution)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [
  path.resolve(__dirname, "../../../.env"),  // from src/
  path.resolve(__dirname, "../../.env"),     // from dist/
  path.resolve(process.cwd(), ".env"),       // from cwd
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
import { SessionWatcher, type SessionEvent, type SessionState } from "./watcher.js";
import { StreamServer } from "./server.js";
import { formatStatus } from "./status.js";

const PORT = parseInt(process.env.PORT ?? "4450", 10);
const API_PORT = parseInt(process.env.API_PORT ?? "4451", 10);
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS ?? "24", 10);
const MAX_AGE_MS = MAX_AGE_HOURS * 60 * 60 * 1000;
const SIGNALS_DIR = `${process.env.HOME}/.claude/session-signals`;

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/**
 * Check if a session is recent enough to include
 */
function isRecentSession(session: SessionState): boolean {
  const lastActivity = new Date(session.status.lastActivityAt).getTime();
  return Date.now() - lastActivity < MAX_AGE_MS;
}

/**
 * Create HTTP API server for session management endpoints.
 * Handles CORS and provides endpoints for dismissing orphaned sessions.
 */
function createApiServer(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // POST /api/sessions/:sessionId/end - Mark session as ended
    const match = req.url?.match(/^\/api\/sessions\/([^/]+)\/end$/);
    if (match && req.method === "POST") {
      const sessionId = decodeURIComponent(match[1]);

      // Ensure signals directory exists
      if (!existsSync(SIGNALS_DIR)) {
        mkdirSync(SIGNALS_DIR, { recursive: true });
      }

      const signalPath = join(SIGNALS_DIR, `${sessionId}.ended.json`);
      const signal = {
        session_id: sessionId,
        ended_at: new Date().toISOString(),
        source: "ui_dismiss",
      };

      try {
        writeFileSync(signalPath, JSON.stringify(signal, null, 2));
        console.log(
          `${colors.gray}${new Date().toLocaleTimeString()}${colors.reset} ` +
          `${colors.blue}[END]${colors.reset} ` +
          `${colors.cyan}${sessionId.slice(0, 8)}${colors.reset} ` +
          `${colors.dim}dismissed by user${colors.reset}`
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, sessionId }));
      } catch (error) {
        console.error(`${colors.yellow}[ERROR]${colors.reset} Failed to create end signal:`, error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Failed to create signal file" }));
      }
      return;
    }

    // 404 for all other routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}

async function main(): Promise<void> {
  console.log(`${colors.bold}Claude Code Session Daemon${colors.reset}`);
  console.log(`${colors.dim}Showing sessions from last ${MAX_AGE_HOURS} hours${colors.reset}`);
  console.log();

  // Start the durable streams server
  const streamServer = new StreamServer({ port: PORT });
  await streamServer.start();

  // Start the API server for session management
  const apiServer = createApiServer();
  apiServer.listen(API_PORT, "127.0.0.1", () => {
    console.log(`API server: ${colors.cyan}http://127.0.0.1:${API_PORT}${colors.reset}`);
  });

  console.log(`Stream URL: ${colors.cyan}${streamServer.getStreamUrl()}${colors.reset}`);
  console.log();

  // Start the session watcher
  const watcher = new SessionWatcher({ debounceMs: 100 });

  watcher.on("session", async (event: SessionEvent) => {
    const { type, session, priority } = event;

    // Only publish recent sessions
    if (!isRecentSession(session) && type !== "deleted") {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();

    // Log to console - show directory name for easier identification
    const statusStr = formatStatus(session.status);
    const dirName = session.cwd.split("/").pop() || session.cwd;
    const priorityIndicator = priority === 'high' ? '⚡' : '';

    console.log(
      `${colors.gray}${timestamp}${colors.reset} ` +
      `${type === "created" ? colors.green : type === "deleted" ? colors.blue : colors.yellow}[${type.toUpperCase().slice(0, 3)}]${colors.reset} ` +
      `${priorityIndicator}${colors.cyan}${session.sessionId.slice(0, 8)}${colors.reset} ` +
      `${colors.dim}${dirName}${colors.reset} ` +
      `${statusStr}`
    );

    // Publish to stream
    try {
      const operation = type === "created" ? "insert" : type === "deleted" ? "delete" : "update";

      // Route based on priority
      if (priority === 'high') {
        await streamServer.publishSessionFastPath(session, operation);
      } else {
        await streamServer.publishSession(session, operation);
      }
    } catch (error) {
      console.error(`${colors.yellow}[ERROR]${colors.reset} Failed to publish:`, error);
    }
  });

  watcher.on("error", (error: Error) => {
    console.error(`${colors.yellow}[ERROR]${colors.reset}`, error.message);
  });

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log();
    console.log(`${colors.dim}Shutting down...${colors.reset}`);
    watcher.stop();
    apiServer.close();
    await streamServer.stop();
    process.exit(0);
  });

  // Start watching
  await watcher.start();

  // Publish initial sessions (filtered to recent only)
  const allSessions = watcher.getSessions();
  const recentSessions = Array.from(allSessions.values()).filter(isRecentSession);

  console.log(`${colors.dim}Found ${recentSessions.length} recent sessions (of ${allSessions.size} total), publishing...${colors.reset}`);

  for (const session of recentSessions) {
    try {
      await streamServer.publishSession(session, "insert");
    } catch (error) {
      console.error(`${colors.yellow}[ERROR]${colors.reset} Failed to publish initial session:`, error);
    }
  }

  console.log();
  console.log(`${colors.green}✓${colors.reset} Ready - watching for changes`);
  console.log(`${colors.dim}Press Ctrl+C to exit${colors.reset}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
