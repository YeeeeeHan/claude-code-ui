import { Box, Flex, Heading, Text, Theme } from "@radix-ui/themes";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { getSessionsDb } from "../data/sessionsDb";

export const Route = createRootRoute({
  loader: async () => {
    // Initialize db and preload data before any route renders
    await getSessionsDb();
    return {};
  },
  component: RootLayout,
});

function RootLayout() {
  return (
    <Theme
      accentColor="violet"
      grayColor="slate"
      radius="medium"
      scaling="110%"
      appearance="dark"
    >
      <Box px="4" pt="6" pb="2" style={{ maxWidth: "1800px", margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Flex align="center" gap="2" mb="5" style={{ flexShrink: 0 }}>
          <Heading size="5" weight="bold">
            Sessions
          </Heading>
          <Text size="1" color="gray">
            Claude Code
          </Text>
        </Flex>
        <Outlet />
      </Box>
      <TanStackRouterDevtools />
    </Theme>
  );
}
