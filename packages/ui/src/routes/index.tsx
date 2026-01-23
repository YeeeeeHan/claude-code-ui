import { createFileRoute } from "@tanstack/react-router";
import { Flex, Text, Box, ScrollArea } from "@radix-ui/themes";
import { useEffect, useState, useCallback } from "react";
import { RepoSection } from "../components/RepoSection";
import { SessionDetailPanel } from "../components/SessionDetailPanel";
import { useSessions, groupSessionsByRepo } from "../hooks/useSessions";
import { requestNotificationPermission, checkAndNotify } from "../utils/notifications";
import { dismissSession } from "../utils/api";
import type { Session } from "../data/schema";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { sessions } = useSessions();
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  // Force re-render every minute to update relative times and activity scores
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

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
  }, []);

  const repoGroups = groupSessionsByRepo(sessions);

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
