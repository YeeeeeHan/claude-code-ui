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
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
 * Navigate to a tmux pane and focus iTerm2
 * Supports both regular tmux and tmux -CC (iTerm2 integration) mode
 */
async function navigateToPane(paneInfo: { tmux_pane: string; tmux_session: string; tmux_window: string }): Promise<void> {
  const target = `${paneInfo.tmux_session}:${paneInfo.tmux_window}`;

  // Select the window first (this triggers iTerm2 tab switch in -CC mode)
  await execAsync(`tmux select-window -t "${target}"`);

  // Then select the specific pane within that window
  await execAsync(`tmux select-pane -t "${paneInfo.tmux_pane}"`);

  // Bring iTerm2 to foreground
  await execAsync(`osascript -e 'tell application "iTerm2" to activate'`);
}

/**
 * Check if a session is recent enough to include
 */
function isRecentSession(session: SessionState): boolean {
  const lastActivity = new Date(session.status.lastActivityAt).getTime();
  return Date.now() - lastActivity < MAX_AGE_MS;
}

/**
 * Create HTTP API server for session management endpoints.
 * Handles:
 * - POST /api/navigate/:sessionId - Navigate to tmux pane
 * - POST /api/sessions/:sessionId/end - Dismiss orphaned session
 */
function createApiServer(watcher: SessionWatcher): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url ?? "/";

    // POST /api/navigate/:sessionId - Navigate to tmux pane
    const navigateMatch = url.match(/^\/api\/navigate\/([^/]+)$/);
    if (navigateMatch && req.method === "POST") {
      const sessionId = decodeURIComponent(navigateMatch[1]);

      try {
        const paneInfo = watcher.getPaneInfo(sessionId);

        if (!paneInfo) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Pane not found",
            message: "No tmux pane registered for this session. Make sure you started Claude in a tmux pane.",
          }));
          return;
        }

        await navigateToPane(paneInfo);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          pane: paneInfo.tmux_pane,
          session: paneInfo.tmux_session,
          window: paneInfo.tmux_window,
        }));
      } catch (error) {
        console.error(`${colors.yellow}[ERROR]${colors.reset} Navigate failed:`, error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Navigation failed",
          message: error instanceof Error ? error.message : "Unknown error",
        }));
      }
      return;
    }

    // POST /api/sessions/:sessionId/end - Mark session as ended (dismiss)
    const endMatch = url.match(/^\/api\/sessions\/([^/]+)\/end$/);
    if (endMatch && req.method === "POST") {
      const sessionId = decodeURIComponent(endMatch[1]);

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

    // GET /api/health
    if (url === "/api/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
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

  console.log(`Stream URL: ${colors.cyan}${streamServer.getStreamUrl()}${colors.reset}`);

  // Start the session watcher
  const watcher = new SessionWatcher({ debounceMs: 100 });

  // Start the API server
  const apiServer = createApiServer(watcher);
  await new Promise<void>((resolve) => {
    apiServer.listen(API_PORT, "127.0.0.1", () => {
      console.log(`API URL: ${colors.cyan}http://127.0.0.1:${API_PORT}${colors.reset}`);
      console.log();
      resolve();
    });
  });

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
