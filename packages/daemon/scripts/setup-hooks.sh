#!/bin/bash
# Installs claude-code-ui hooks to ~/.claude/hooks/
# These hooks enable the dashboard to track session state and navigate to terminals
#
# Hooks installed:
# - session-start.sh    : registers tmux pane for click-to-navigate
# - user-prompt-submit.sh: marks session as "working"
# - permission-request.sh: marks session as waiting for approval
# - stop.sh             : marks session as waiting for user input
# - session-end.sh      : marks session as idle

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_SOURCE="$SCRIPT_DIR/hooks"
HOOKS_DEST="$HOME/.claude/hooks"
SIGNALS_DIR="$HOME/.claude/session-signals"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Installing claude-code-ui hooks..."

# Create directories
mkdir -p "$HOOKS_DEST"
mkdir -p "$SIGNALS_DIR"

# Copy hooks to global location
cp "$HOOKS_SOURCE/session-start.sh" "$HOOKS_DEST/"
cp "$HOOKS_SOURCE/user-prompt-submit.sh" "$HOOKS_DEST/"
cp "$HOOKS_SOURCE/permission-request.sh" "$HOOKS_DEST/"
cp "$HOOKS_SOURCE/stop.sh" "$HOOKS_DEST/"
cp "$HOOKS_SOURCE/session-end.sh" "$HOOKS_DEST/"

# Make executable
chmod +x "$HOOKS_DEST"/*.sh

echo "Hooks installed to $HOOKS_DEST"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo ""
    echo "Warning: jq is not installed. You'll need to manually update settings.json"
    echo "Install with: brew install jq"
    exit 0
fi

# Backup settings
if [ -f "$SETTINGS_FILE" ]; then
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"
fi

# Update settings.json with hook configuration
jq '
  .hooks.SessionStart = [{"matcher": "", "hooks": [{"type": "command", "command": ($ENV.HOME + "/.claude/hooks/session-start.sh")}]}] |
  .hooks.UserPromptSubmit = [{"matcher": "", "hooks": [{"type": "command", "command": ($ENV.HOME + "/.claude/hooks/user-prompt-submit.sh")}]}] |
  .hooks.PermissionRequest = [{"matcher": "", "hooks": [{"type": "command", "command": ($ENV.HOME + "/.claude/hooks/permission-request.sh")}]}] |
  .hooks.Stop = [{"matcher": "", "hooks": [{"type": "command", "command": ($ENV.HOME + "/.claude/hooks/stop.sh")}]}] |
  .hooks.SessionEnd = [{"matcher": "", "hooks": [{"type": "command", "command": ($ENV.HOME + "/.claude/hooks/session-end.sh")}]}]
' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"

echo "Updated $SETTINGS_FILE"
echo ""
echo "Setup complete! Restart Claude Code sessions for hooks to take effect."
