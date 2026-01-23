/**
 * API client for communicating with the daemon
 */

const API_BASE = "http://127.0.0.1:4451";

export interface NavigateResult {
  success: boolean;
  pane?: string;
  session?: string;
  window?: string;
  error?: string;
  message?: string;
}

/**
 * Navigate to a session's tmux pane in iTerm2
 */
export async function navigateToSession(sessionId: string): Promise<NavigateResult> {
  try {
    const response = await fetch(`${API_BASE}/api/navigate/${sessionId}`, {
      method: "POST",
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error,
        message: data.message,
      };
    }

    return {
      success: true,
      pane: data.pane,
      session: data.session,
      window: data.window,
    };
  } catch (error) {
    return {
      success: false,
      error: "Connection failed",
      message: error instanceof Error ? error.message : "Failed to connect to daemon",
    };
  }
}

/**
 * Dismiss an orphaned session by creating an ended signal.
 */
export async function dismissSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to dismiss session: ${response.status}`);
  }
}
