import { Box, Flex, Heading, Link, Text, Separator } from "@radix-ui/themes";
import { SessionTable } from "./SessionTable";
import type { Session } from "../data/schema";

interface RepoSectionProps {
  repoId: string;
  repoUrl: string | null;
  sessions: Session[];
  activityScore: number;
  onDismiss?: (sessionId: string) => void;
}

export function RepoSection({ repoId, repoUrl, sessions, activityScore, onDismiss }: RepoSectionProps) {
  const isHot = activityScore > 50;

  return (
    <Box mb="7">
      <Flex align="center" gap="3" mb="4">
        <Heading size="6" weight="bold">
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
          <Text size="2" color="orange">
            🔥
          </Text>
        )}
        <Text size="2" color="gray">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </Text>
      </Flex>

      <SessionTable sessions={sessions} onDismiss={onDismiss} />

      <Separator size="4" mt="6" />
    </Box>
  );
}
