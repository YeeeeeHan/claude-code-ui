#!/bin/bash
# Hook script for UserPromptSubmit events (user sends message)
# Writes working signal to ~/.claude/session-signals/<session_id>.working.json
# This definitively marks the session as "working" when user starts a turn

SIGNALS_DIR="$HOME/.claude/session-signals"
mkdir -p "$SIGNALS_DIR"

# Read JSON from stdin
INPUT=$(cat)

# Extract session_id
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -n "$SESSION_ID" ]; then
  # DEBUG: Log what Claude CLI sends
  echo "=== UserPromptSubmit hook called at $(date) ===" >> "$SIGNALS_DIR/hooks-debug.log"
  echo "$INPUT" | jq '.' >> "$SIGNALS_DIR/hooks-debug.log"
  echo "" >> "$SIGNALS_DIR/hooks-debug.log"

  # Write working signal with timestamp
  echo "$INPUT" | jq -c '. + {working_since: (now | tostring)}' > "$SIGNALS_DIR/$SESSION_ID.working.json"

  # Clear stop signal since new turn is starting
  rm -f "$SIGNALS_DIR/$SESSION_ID.stop.json"
fi
