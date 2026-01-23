#!/bin/bash
# Hook script for SessionStart events (Claude session begins)
# Writes tmux pane info to ~/.claude/session-signals/<session_id>.pane.json
# This enables click-to-navigate from dashboard to terminal

SIGNALS_DIR="$HOME/.claude/session-signals"
mkdir -p "$SIGNALS_DIR"

# Read JSON from stdin
INPUT=$(cat)

# Extract session_id
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -n "$SESSION_ID" ]; then
  # DEBUG: Log hook call
  echo "=== SessionStart hook called at $(date) ===" >> "$SIGNALS_DIR/hooks-debug.log"
  echo "$INPUT" | jq '.' >> "$SIGNALS_DIR/hooks-debug.log"

  # Check if running in tmux
  if [ -n "$TMUX_PANE" ]; then
    # Get tmux session, window, and pane info
    TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "")
    TMUX_WINDOW=$(tmux display-message -p '#I' 2>/dev/null || echo "")

    # Write pane info
    jq -n \
      --arg session_id "$SESSION_ID" \
      --arg tmux_pane "$TMUX_PANE" \
      --arg tmux_session "$TMUX_SESSION" \
      --arg tmux_window "$TMUX_WINDOW" \
      --arg registered_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{
        session_id: $session_id,
        tmux_pane: $tmux_pane,
        tmux_session: $tmux_session,
        tmux_window: $tmux_window,
        registered_at: $registered_at
      }' > "$SIGNALS_DIR/$SESSION_ID.pane.json"

    echo "Registered tmux pane: $TMUX_PANE (session: $TMUX_SESSION, window: $TMUX_WINDOW)" >> "$SIGNALS_DIR/hooks-debug.log"
  else
    echo "Not running in tmux, skipping pane registration" >> "$SIGNALS_DIR/hooks-debug.log"
  fi

  echo "" >> "$SIGNALS_DIR/hooks-debug.log"
fi
