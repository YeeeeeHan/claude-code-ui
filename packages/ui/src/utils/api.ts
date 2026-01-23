const API_BASE_URL = "http://127.0.0.1:4451";

/**
 * Dismiss an orphaned session by creating an ended signal.
 */
export async function dismissSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to dismiss session: ${response.status}`);
  }
}
