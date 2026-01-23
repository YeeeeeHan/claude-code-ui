import { Flex, Text, Heading, Box, Badge, Separator, Blockquote, Code } from "@radix-ui/themes";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Session, CIStatus } from "../data/schema";

const codeTheme = {
  ...oneDark,
  'comment': { ...oneDark['comment'], color: '#8b949e' },
  'prolog': { ...oneDark['prolog'], color: '#8b949e' },
  'doctype': { ...oneDark['doctype'], color: '#8b949e' },
  'cdata': { ...oneDark['cdata'], color: '#8b949e' },
};

interface SessionDetailPanelProps {
  session: Session | null;
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

export function SessionDetailPanel({ session }: SessionDetailPanelProps) {
  if (!session) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        style={{ height: "100%", color: "var(--gray-9)" }}
      >
        <Text size="2">Select a session to view details</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="3" style={{ height: "100%", overflow: "hidden" }}>
      {/* Header: goal */}
      <Heading size="2" weight="bold" highContrast>
        {session.goal || session.originalPrompt.slice(0, 80)}
      </Heading>

      {/* Meta info */}
      <Flex gap="2" wrap="wrap" align="center">
        {session.gitBranch && (
          <Code size="1" variant="soft" color="green">
            {session.gitBranch}
          </Code>
        )}
        <Text size="1" color="gray">
          {session.cwd.replace(/^\/Users\/\w+\//, "~/")}
        </Text>
      </Flex>

      {/* Recent output */}
      <Flex
        direction="column"
        gap="1"
        p="2"
        flexGrow="1"
        style={{
          backgroundColor: "var(--gray-2)",
          borderRadius: "var(--radius-2)",
          overflow: "auto",
          minHeight: 0,
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
                  <Separator size="4" color="blue" mb="3" />
                  <Text as="p" size="1" weight="medium" mb="2">You:</Text>
                </>
              )}
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <Text as="p" size="1" mb="3">{children}</Text>,
                  code: ({ className, children }) => {
                    const match = /language-(\w+)/.exec(className || "");
                    const isBlock = Boolean(match);
                    return isBlock ? (
                      <SyntaxHighlighter
                        style={codeTheme}
                        language={match![1]}
                        PreTag="div"
                        customStyle={{ margin: 0, borderRadius: "var(--radius-2)", fontSize: "10px" }}
                      >
                        {String(children).replace(/\n$/, "")}
                      </SyntaxHighlighter>
                    ) : (
                      <Code size="1">{children}</Code>
                    );
                  },
                  pre: ({ children }) => <Box mb="3">{children}</Box>,
                  ul: ({ children }) => (
                    <ul style={{ paddingLeft: "var(--space-4)", marginBottom: "var(--space-3)", listStyleType: "disc" }}>
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol style={{ paddingLeft: "var(--space-4)", marginBottom: "var(--space-3)", listStyleType: "decimal" }}>
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li style={{ marginBottom: "var(--space-1)", fontSize: "11px" }}>{children}</li>,
                  h1: ({ children }) => <Heading size="2" mb="3">{children}</Heading>,
                  h2: ({ children }) => <Heading size="1" mb="3">{children}</Heading>,
                  h3: ({ children }) => <Text size="1" weight="bold" mb="3">{children}</Text>,
                  blockquote: ({ children }) => <Blockquote size="1" mb="3">{children}</Blockquote>,
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
                <Separator size="4" color="blue" my="3" />
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
          <Flex align="center" gap="2" mb="1">
            <a
              href={session.pr.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "11px", fontWeight: 500 }}
            >
              PR #{session.pr.number}: {session.pr.title}
            </a>
          </Flex>
          {session.pr.ciChecks.length > 0 && (
            <Flex gap="1" wrap="wrap">
              {session.pr.ciChecks.map((check) => (
                <Badge
                  key={check.name}
                  color={getCIStatusColor(check.status)}
                  variant="soft"
                  size="1"
                >
                  {getCIStatusIcon(check.status)} {check.name.slice(0, 15)}
                </Badge>
              ))}
            </Flex>
          )}
        </Box>
      )}

      {/* Footer */}
      <Flex justify="between">
        <Text size="1" color="gray">
          {session.sessionId.slice(0, 8)}
        </Text>
      </Flex>
    </Flex>
  );
}
