import { createFileRoute } from "@tanstack/react-router";
import { Flex, Text, Box, ScrollArea } from "@radix-ui/themes";
import { useEffect, useState, useCallback, useMemo } from "react";
import { RepoSection } from "../components/RepoSection";
import { SessionDetailPanel } from "../components/SessionDetailPanel";
import { useSessions, groupSessionsByRepo } from "../hooks/useSessions";
import { requestNotificationPermission, checkAndNotify } from "../utils/notifications";
import { dismissSession, navigateToSession } from "../utils/api";
import type { Session } from "../data/schema";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { sessions } = useSessions();
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);

  // Force re-render every minute to update relative times and activity scores
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const repoGroups = groupSessionsByRepo(sessions);

  // Flatten sessions in display order for keyboard navigation
  const flattenedSessions = useMemo(() => {
    const result: Session[] = [];
    for (const group of repoGroups) {
      // Sort sessions within group by lastActivityAt desc (same as SessionTable)
      const sorted = [...group.sessions].sort(
        (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
      );
      result.push(...sorted);
    }
    return result;
  }, [repoGroups]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (flattenedSessions.length === 0) return;

      const currentIndex = highlightedSessionId
        ? flattenedSessions.findIndex((s) => s.sessionId === highlightedSessionId)
        : -1;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const nextIndex = currentIndex < flattenedSessions.length - 1 ? currentIndex + 1 : 0;
        const nextSession = flattenedSessions[nextIndex];
        setHighlightedSessionId(nextSession.sessionId);
        setSelectedSession(nextSession);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : flattenedSessions.length - 1;
        const prevSession = flattenedSessions[prevIndex];
        setHighlightedSessionId(prevSession.sessionId);
        setSelectedSession(prevSession);
      } else if (e.key === "Enter" && highlightedSessionId) {
        e.preventDefault();
        navigateToSession(highlightedSessionId).then((result) => {
          if (!result.success) {
            console.error("Navigation failed:", result.error || result.message);
          }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flattenedSessions, highlightedSessionId]);

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Watch for session state transitions and notify
  useEffect(() => {
    checkAndNotify(sessions);
  }, [sessions]);

  // Update selected session when sessions change (to get latest data)
  useEffect(() => {
    if (selectedSession) {
      const updated = sessions.find((s) => s.sessionId === selectedSession.sessionId);
      if (updated) {
        setSelectedSession(updated);
      } else {
        // Session was removed, clear selection
        setSelectedSession(null);
      }
    }
  }, [sessions, selectedSession?.sessionId]);

  // Handle dismissing orphaned sessions
  const handleDismiss = useCallback(async (sessionId: string) => {
    try {
      await dismissSession(sessionId);
    } catch (error) {
      console.error("Failed to dismiss session:", error);
    }
  }, []);

  const handleSelectSession = useCallback((session: Session) => {
    setSelectedSession(session);
    setHighlightedSessionId(session.sessionId);
  }, []);

  if (repoGroups.length === 0) {
    return (
      <Flex direction="column" align="center" gap="3" py="9">
        <Text color="gray" size="2">
          No active sessions
        </Text>
        <Text color="gray" size="1">
          Start a Claude Code session to see it here
        </Text>
      </Flex>
    );
  }

  return (
    <Flex style={{ flex: 1, minHeight: 0, gap: "var(--space-3)" }}>
      {/* Left panel: session list */}
      <Box style={{ flex: "1 1 60%", minWidth: 0, overflow: "hidden" }}>
        <ScrollArea style={{ height: "100%" }} scrollbars="vertical">
          <Flex direction="column" pr="2" pt="1">
            {repoGroups.map((group) => (
              <RepoSection
                key={group.repoId}
                repoId={group.repoId}
                repoUrl={group.repoUrl}
                sessions={group.sessions}
                activityScore={group.activityScore}
                selectedSessionId={selectedSession?.sessionId}
                highlightedSessionId={highlightedSessionId}
                onSelectSession={handleSelectSession}
                onDismiss={handleDismiss}
              />
            ))}
          </Flex>
        </ScrollArea>
      </Box>

      {/* Right panel: session detail */}
      <Box
        style={{
          flex: "0 0 340px",
          borderLeft: "1px solid var(--gray-6)",
          paddingLeft: "var(--space-4)",
          overflow: "hidden",
        }}
      >
        <SessionDetailPanel session={selectedSession} />
      </Box>
    </Flex>
  );
}
