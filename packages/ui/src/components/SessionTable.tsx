import { Table, Text, Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { Cross2Icon } from "@radix-ui/react-icons";
import type { Session } from "../data/schema";

interface SessionTableProps {
  sessions: Session[];
  selectedSessionId?: string | null;
  highlightedSessionId?: string | null;
  onSelectSession?: (session: Session) => void;
  onDismiss?: (sessionId: string) => void;
}

type EffectiveStatus = "working" | "approval" | "waiting" | "idle";

function getEffectiveStatus(session: Session): EffectiveStatus {
  if (session.status === "working") {
    return "working";
  }
  if (session.status === "waiting" && session.hasPendingToolUse) {
    return "approval";
  }
  if (session.status === "idle") {
    return "idle";
  }
  return "waiting";
}

function getStatusDisplay(status: EffectiveStatus): { symbol: string; label: string; color: "yellow" | "orange" | "gray" } {
  switch (status) {
    case "working":
      return { symbol: "*", label: "working", color: "yellow" };
    case "approval":
      return { symbol: "!", label: "approval", color: "orange" };
    case "waiting":
      return { symbol: ".", label: "waiting", color: "gray" };
    case "idle":
      return { symbol: ".", label: "idle", color: "gray" };
  }
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

interface SessionRowProps {
  session: Session;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect?: (session: Session) => void;
  onDismiss?: (sessionId: string) => void;
}

function SessionRow({ session, isSelected, isHighlighted, onSelect, onDismiss }: SessionRowProps) {
  const effectiveStatus = getEffectiveStatus(session);
  const statusDisplay = getStatusDisplay(effectiveStatus);
  const canDismiss = effectiveStatus === "waiting" || effectiveStatus === "idle";
  const parts = session.cwd.split("/");
  const dirPath = parts.slice(-2).join("/");

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDismiss?.(session.sessionId);
  };

  const handleClick = () => {
    onSelect?.(session);
  };

  return (
    <Table.Row
      onClick={handleClick}
      style={{
        cursor: "pointer",
        backgroundColor: isSelected ? "var(--accent-4)" : undefined,
        boxShadow: isHighlighted ? "inset 3px 0 0 var(--cyan-9)" : isSelected ? "inset 3px 0 0 var(--accent-9)" : undefined,
        outline: isHighlighted ? "1px solid var(--cyan-7)" : undefined,
      }}
    >
      <Table.Cell>
        <Text size="1" color={statusDisplay.color} style={{ fontFamily: "var(--code-font-family)", whiteSpace: "nowrap" }}>
          {statusDisplay.symbol} {statusDisplay.label}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text size="1" color="gray" style={{ fontFamily: "var(--code-font-family)" }}>
          {dirPath}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {session.gitBranch ? (
          <Text size="1" color="green" style={{ fontFamily: "var(--code-font-family)" }}>
            {session.gitBranch}
          </Text>
        ) : (
          <Text size="1" color="gray">—</Text>
        )}
      </Table.Cell>
      <Table.Cell>
        <Flex align="center" gap="1" justify="between">
          <Text size="1" color="gray">{formatTimeAgo(session.lastActivityAt)}</Text>
          {canDismiss && onDismiss && (
            <Tooltip content="Dismiss session">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={handleDismiss}
                style={{ cursor: "pointer" }}
              >
                <Cross2Icon />
              </IconButton>
            </Tooltip>
          )}
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}

export function SessionTable({ sessions, selectedSessionId, highlightedSessionId, onSelectSession, onDismiss }: SessionTableProps) {
  // Sort by age (youngest/most recent first)
  const sortedSessions = [...sessions].sort((a, b) => {
    const aTime = new Date(a.lastActivityAt).getTime();
    const bTime = new Date(b.lastActivityAt).getTime();
    return bTime - aTime;
  });

  return (
    <Table.Root variant="surface" size="1">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell style={{ width: 90 }}>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Directory</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell style={{ width: 100 }}>Branch</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell style={{ width: 70 }}>Age</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {sortedSessions.map((session) => (
          <SessionRow
            key={session.sessionId}
            session={session}
            isSelected={session.sessionId === selectedSessionId}
            isHighlighted={session.sessionId === highlightedSessionId}
            onSelect={onSelectSession}
            onDismiss={onDismiss}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}
