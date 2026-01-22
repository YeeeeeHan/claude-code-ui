import { createStreamDB, type StreamDB } from "@durable-streams/state";
import { sessionsStateSchema } from "./schema";

const STREAM_URL = "http://127.0.0.1:4450/sessions";

export type SessionsDB = StreamDB<typeof sessionsStateSchema>;

let dbInstance: SessionsDB | null = null;
let dbPromise: Promise<SessionsDB> | null = null;

/**
 * Get or create the sessions StreamDB instance.
 * Call this in a route loader to ensure db is ready before render.
 */
export async function getSessionsDb(): Promise<SessionsDB> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const streamOptions = {
        url: STREAM_URL,
        // contentType tells the server what format to send in each SSE data: line
        contentType: "application/json",
        // Enable Server-Sent Events for real-time updates (<100ms latency vs 2-10s with long-polling)
        live: "sse" as const,
        // Required: hint that SSE data is JSON (Content-Type is text/event-stream for SSE)
        json: true,
        // Fallback to long-polling if SSE fails repeatedly
        sseResilience: {
          maxShortConnections: 3,
          logWarnings: true,
        },
      };

      console.log('[SessionsDB] Creating StreamDB with options:', streamOptions);

      const db = await createStreamDB({
        streamOptions,
        state: sessionsStateSchema,
      });

      // Preload existing data
      await db.preload();

      dbInstance = db;
      return db;
    })();
  }

  return dbPromise;
}

/**
 * Get the db instance synchronously.
 * Only call this after getSessionsDb() has resolved (e.g., after loader).
 * Throws if db is not initialized.
 */
export function getSessionsDbSync(): SessionsDB {
  if (!dbInstance) {
    throw new Error("SessionsDB not initialized. Call getSessionsDb() first in a loader.");
  }
  return dbInstance;
}

/**
 * Close the sessions DB connection.
 */
export async function closeSessionsDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    dbPromise = null;
  }
}
