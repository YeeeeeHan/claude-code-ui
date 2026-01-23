import { Box, Flex, Heading, Link, Text, Separator } from "@radix-ui/themes";
import { SessionTable } from "./SessionTable";
import type { Session } from "../data/schema";

interface RepoSectionProps {
  repoId: string;
  repoUrl: string | null;
  sessions: Session[];
  activityScore: number;
  selectedSessionId?: string | null;
  onSelectSession?: (session: Session) => void;
  onDismiss?: (sessionId: string) => void;
}

export function RepoSection({
  repoId,
  repoUrl,
  sessions,
  activityScore,
  selectedSessionId,
  onSelectSession,
  onDismiss,
}: RepoSectionProps) {
  const isHot = activityScore > 50;

  return (
    <Box mb="4">
      <Flex align="center" gap="2" mb="3">
        <Heading size="3" weight="bold">
          {repoId === "Other" ? (
            <Text color="gray">Other</Text>
          ) : repoUrl ? (
            <Link href={repoUrl} target="_blank" color="violet" highContrast>
              {repoId}
            </Link>
          ) : (
            repoId
          )}
        </Heading>
        {isHot && (
          <Text size="1" color="orange">
            🔥
          </Text>
        )}
        <Text size="1" color="gray">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </Text>
      </Flex>

      <SessionTable
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
        onDismiss={onDismiss}
      />

      <Separator size="4" mt="4" />
    </Box>
  );
}
