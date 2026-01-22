import { Table, Text, Code, HoverCard, Flex, Heading, Box, Badge, Separator, Blockquote } from "@radix-ui/themes";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Session, CIStatus } from "../data/schema";

// Customize oneDark to improve comment contrast
const codeTheme = {
  ...oneDark,
  'comment': { ...oneDark['comment'], color: '#8b949e' },
  'prolog': { ...oneDark['prolog'], color: '#8b949e' },
  'doctype': { ...oneDark['doctype'], color: '#8b949e' },
  'cdata': { ...oneDark['cdata'], color: '#8b949e' },
};

interface SessionTableProps {
  sessions: Session[];
}

type EffectiveStatus = "working" | "approval" | "waiting" | "idle";

function getEffectiveStatus(session: Session): EffectiveStatus {
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
  const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();

  if (elapsed > IDLE_TIMEOUT_MS) {
    return "idle";
  }
  if (session.status === "working") {
    return "working";
  }
  if (session.status === "waiting" && session.hasPendingToolUse) {
    return "approval";
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

function getRoleColor(role: "user" | "assistant" | "tool"): string {
  switch (role) {
    case "user":
      return "var(--blue-11)";
    case "assistant":
      return "var(--gray-12)";
    case "tool":
      return "var(--violet-11)";
  }
}

function getCIStatusIcon(status: CIStatus): string {
  switch (status) {
    case "success":
      return "✓";
    case "failure":
      return "✗";
    case "running":
    case "pending":
      return "◎";
    case "cancelled":
      return "⊘";
    default:
      return "?";
  }
}

function getCIStatusColor(status: CIStatus): "green" | "red" | "yellow" | "gray" {
  switch (status) {
    case "success":
      return "green";
    case "failure":
      return "red";
    case "running":
    case "pending":
      return "yellow";
    default:
      return "gray";
  }
}

function SessionRow({ session }: { session: Session }) {
  const effectiveStatus = getEffectiveStatus(session);
  const statusDisplay = getStatusDisplay(effectiveStatus);
  // Show only last 2 levels of the path (e.g., "useful_resources/claude-code-ui")
  const parts = session.cwd.split("/");
  const dirPath = parts.slice(-2).join("/");

  return (
    <HoverCard.Root openDelay={400}>
      <HoverCard.Trigger>
        <Table.Row style={{ cursor: "pointer" }}>
          <Table.Cell>
            <Flex align="center" gap="2" wrap="wrap">
              <Text color={statusDisplay.color} style={{ fontFamily: "var(--code-font-family)" }}>
                {statusDisplay.symbol} {statusDisplay.label}
              </Text>
              {session.isLive && (
                <Badge color="green" variant="soft" size="1">
                  LIVE
                </Badge>
              )}
            </Flex>
          </Table.Cell>
          <Table.Cell>
            <Text color="gray" style={{ fontFamily: "var(--code-font-family)" }}>
              {dirPath}
            </Text>
          </Table.Cell>
          <Table.Cell>
            {session.gitBranch ? (
              <Text color="green" style={{ fontFamily: "var(--code-font-family)" }}>
                {session.gitBranch}
              </Text>
            ) : (
              <Text color="gray">—</Text>
            )}
          </Table.Cell>
          <Table.Cell>
            <Text color="gray">{formatTimeAgo(session.lastActivityAt)}</Text>
          </Table.Cell>
        </Table.Row>
      </HoverCard.Trigger>

      <HoverCard.Content
        size="3"
        side="right"
        sideOffset={8}
        collisionPadding={20}
        style={{ width: 500, maxWidth: "calc(100vw - 40px)", maxHeight: "calc(100vh - 40px)" }}
      >
        <Flex direction="column" gap="3" style={{ height: "100%" }}>
          {/* Header: goal */}
          <Heading size="3" weight="bold" highContrast>
            {session.goal || session.originalPrompt.slice(0, 60)}
          </Heading>

          {/* Recent output */}
          <Flex
            direction="column"
            gap="1"
            p="3"
            flexGrow="1"
            style={{
              backgroundColor: "var(--gray-2)",
              borderRadius: "var(--radius-3)",
              overflow: "auto",
            }}
          >
            {session.recentOutput?.length > 0 ? (
              session.recentOutput.map((output, i) => (
                <Box
                  key={i}
                  style={{ color: getRoleColor(output.role) }}
                  className="markdown-content"
                >
                  {output.role === "user" && (
                    <>
                      <Separator size="4" color="blue" mb="4" />
                      <Text as="p" size="1" weight="medium" mb="3">You:</Text>
                    </>
                  )}
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <Text as="p" size="1" mb="4">{children}</Text>,
                      code: ({ className, children }) => {
                        const match = /language-(\w+)/.exec(className || "");
                        const isBlock = Boolean(match);
                        return isBlock ? (
                          <SyntaxHighlighter
                            style={codeTheme}
                            language={match![1]}
                            PreTag="div"
                            customStyle={{ margin: 0, borderRadius: "var(--radius-2)", fontSize: "var(--font-size-1)" }}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        ) : (
                          <Code size="1">{children}</Code>
                        );
                      },
                      pre: ({ children }) => <Box mb="4">{children}</Box>,
                      ul: ({ children }) => (
                        <ul style={{ paddingLeft: "var(--space-5)", marginBottom: "var(--space-4)", listStyleType: "disc" }}>
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol style={{ paddingLeft: "var(--space-5)", marginBottom: "var(--space-4)", listStyleType: "decimal" }}>
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => <li style={{ marginBottom: "var(--space-1)", fontSize: "var(--font-size-1)" }}>{children}</li>,
                      h1: ({ children }) => <Heading size="3" mb="4">{children}</Heading>,
                      h2: ({ children }) => <Heading size="2" mb="4">{children}</Heading>,
                      h3: ({ children }) => <Heading size="1" mb="4">{children}</Heading>,
                      blockquote: ({ children }) => <Blockquote size="1" mb="4">{children}</Blockquote>,
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {output.content}
                  </Markdown>
                  {output.role === "user" && (
                    <Separator size="4" color="blue" my="4" />
                  )}
                </Box>
              ))
            ) : (
              <Text size="1" color="gray">
                No recent output
              </Text>
            )}
            {session.status === "working" && (
              <Text color="grass" size="1">█</Text>
            )}
          </Flex>

          {/* PR Info if available */}
          {session.pr && (
            <Box>
              <Flex align="center" gap="2" mb="2">
                <a
                  href={session.pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "var(--font-size-1)", fontWeight: 500 }}
                >
                  PR #{session.pr.number}: {session.pr.title}
                </a>
              </Flex>
              {session.pr.ciChecks.length > 0 && (
                <Flex gap="2" wrap="wrap">
                  {session.pr.ciChecks.map((check) => (
                    <Badge
                      key={check.name}
                      color={getCIStatusColor(check.status)}
                      variant="soft"
                      size="1"
                    >
                      {getCIStatusIcon(check.status)} {check.name.slice(0, 20)}
                    </Badge>
                  ))}
                </Flex>
              )}
            </Box>
          )}

          {/* Footer */}
          <Flex justify="between">
            <Text size="1" color="gray">
              {session.cwd.replace(/^\/Users\/\w+\//, "~/")}
            </Text>
            <Text size="1" color="gray">
              {session.sessionId.slice(0, 8)}
            </Text>
          </Flex>
        </Flex>
      </HoverCard.Content>
    </HoverCard.Root>
  );
}

export function SessionTable({ sessions }: SessionTableProps) {
  // Sort by status priority and lastActivityAt
  const sortedSessions = [...sessions].sort((a, b) => {
    const statusPriority: Record<EffectiveStatus, number> = {
      working: 0,
      approval: 1,
      waiting: 2,
      idle: 3,
    };
    const aPriority = statusPriority[getEffectiveStatus(a)];
    const bPriority = statusPriority[getEffectiveStatus(b)];

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });

  return (
    <Table.Root variant="surface">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell style={{ width: 160 }}>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Directory</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Branch</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell style={{ width: 60 }}>Age</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {sortedSessions.map((session) => (
          <SessionRow key={session.sessionId} session={session} />
        ))}
      </Table.Body>
    </Table.Root>
  );
}
