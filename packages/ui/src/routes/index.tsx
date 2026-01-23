import { createFileRoute } from "@tanstack/react-router";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState, useCallback } from "react";
import { RepoSection } from "../components/RepoSection";
import { useSessions, groupSessionsByRepo } from "../hooks/useSessions";
import { requestNotificationPermission, checkAndNotify } from "../utils/notifications";
import { dismissSession } from "../utils/api";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { sessions } = useSessions();

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

  // Handle dismissing orphaned sessions
  const handleDismiss = useCallback(async (sessionId: string) => {
    try {
      await dismissSession(sessionId);
    } catch (error) {
      console.error("Failed to dismiss session:", error);
    }
  }, []);

  const repoGroups = groupSessionsByRepo(sessions);

  if (repoGroups.length === 0) {
    return (
      <Flex direction="column" align="center" gap="3" py="9">
        <Text color="gray" size="3">
          No active sessions
        </Text>
        <Text color="gray" size="2">
          Start a Claude Code session to see it here
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column">
      {repoGroups.map((group) => (
        <RepoSection
          key={group.repoId}
          repoId={group.repoId}
          repoUrl={group.repoUrl}
          sessions={group.sessions}
          activityScore={group.activityScore}
          onDismiss={handleDismiss}
        />
      ))}
    </Flex>
  );
}
