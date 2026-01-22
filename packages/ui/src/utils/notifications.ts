/**
 * Browser notification utilities for Claude Code state transitions
 */

import type { Session } from "../data/schema";

// Track notified sessions to prevent duplicates
const notifiedSessions = new Set<string>();

// Track previous effective status for each session to detect transitions
const previousStatus = new Map<string, string>();

/**
 * Get emoji for tool type
 */
function getToolEmoji(tool: string): string {
  const emojiMap: Record<string, string> = {
    'Read': '📖',
    'Edit': '✏️',
    'Write': '📝',
    'Bash': '▶️',
    'Grep': '🔍',
    'Glob': '📁',
    'Task': '🤖',
  };
  return emojiMap[tool] || '🔧';
}

/**
 * Get effective status matching the UI logic from SessionTable.tsx
 */
function getEffectiveStatus(session: Session): string {
  if (session.status === 'waiting' && session.hasPendingToolUse) {
    return 'approval';
  }
  return session.status;
}

/**
 * Request notification permission from the user
 * Should be called on app initialization
 */
export async function requestNotificationPermission(): Promise<boolean> {
  // Check if the browser supports notifications
  if (!('Notification' in window)) {
    console.warn('This browser does not support desktop notifications');
    return false;
  }

  // If already granted, return true
  if (Notification.permission === 'granted') {
    return true;
  }

  // If not denied, request permission
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

/**
 * Show notification when Claude needs approval for tool use
 */
export function notifyApproval(session: Session): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  // Use git repo if available, otherwise directory name
  const repoName = session.gitRepoId || session.cwd.split('/').pop() || session.cwd;

  // Build context with tool info and recent activity
  let context = '';
  if (session.pendingTool) {
    const toolEmoji = getToolEmoji(session.pendingTool.tool);
    const target = session.pendingTool.target.length > 50
      ? session.pendingTool.target.slice(0, 50) + '...'
      : session.pendingTool.target;
    context = `${toolEmoji} ${session.pendingTool.tool}: ${target}`;
  } else {
    context = session.summary?.slice(0, 120) || 'Tool use approval required';
  }

  const notification = new Notification(repoName, {
    body: context,
    icon: '/favicon.svg',
    requireInteraction: true, // User must dismiss (sticky)
    tag: `approval-${session.sessionId}`, // Prevents duplicate notifications
    silent: false, // Play notification sound
  });

  // Focus browser window when clicked
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

/**
 * Show notification when Claude is waiting for user input
 */
export function notifyWaiting(session: Session): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  // Use git repo if available, otherwise directory name
  const repoName = session.gitRepoId || session.cwd.split('/').pop() || session.cwd;

  // Show what Claude just said or did
  let context = '';
  if (session.recentOutput && session.recentOutput.length > 0) {
    const lastOutput = session.recentOutput[session.recentOutput.length - 1];
    if (lastOutput.role === 'assistant') {
      context = lastOutput.content.slice(0, 120);
    } else {
      context = session.summary?.slice(0, 120) || 'Waiting for your input';
    }
  } else {
    context = session.summary?.slice(0, 120) || 'Waiting for your input';
  }

  const notification = new Notification(repoName, {
    body: context,
    icon: '/favicon.svg',
    requireInteraction: true, // Keep visible until dismissed
    tag: `waiting-${session.sessionId}`, // Prevents duplicate notifications
    silent: false, // Play notification sound
  });

  // Focus browser window when clicked
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

/**
 * Check for state transitions and notify accordingly
 * Call this whenever sessions update
 */
export function checkAndNotify(sessions: Session[]): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  for (const session of sessions) {
    const effectiveStatus = getEffectiveStatus(session);
    const notificationKey = `${session.sessionId}-${effectiveStatus}`;

    // Get previous status for this session
    const prevStatus = previousStatus.get(session.sessionId);

    // Only notify on transitions, not persistent states
    if (prevStatus && prevStatus === effectiveStatus) {
      continue; // No transition, skip
    }

    // Check if we've already notified for this state
    if (notifiedSessions.has(notificationKey)) {
      console.log(`[Notifications] Skipping duplicate notification for ${session.gitRepoId || 'session'}: ${prevStatus} → ${effectiveStatus}`);
      continue;
    }

    // Detect transitions and notify
    if (prevStatus === 'working' && effectiveStatus === 'approval') {
      console.log(`[Notifications] ${session.gitRepoId || 'session'}: working → approval (tool: ${session.pendingTool?.tool})`);
      notifyApproval(session);
      notifiedSessions.add(notificationKey);

      // Clear after 60s to allow re-notification
      setTimeout(() => notifiedSessions.delete(notificationKey), 60000);
    } else if (prevStatus === 'working' && effectiveStatus === 'waiting') {
      console.log(`[Notifications] ${session.gitRepoId || 'session'}: working → waiting`);
      notifyWaiting(session);
      notifiedSessions.add(notificationKey);

      // Clear after 60s to allow re-notification
      setTimeout(() => notifiedSessions.delete(notificationKey), 60000);
    }

    // Update previous status
    previousStatus.set(session.sessionId, effectiveStatus);
  }
}
