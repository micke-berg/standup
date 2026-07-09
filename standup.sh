#!/usr/bin/env bash
# Launch the standup board and open it in your default browser (macOS / Linux).
# The Windows equivalent is standup.cmd.
cd "$(dirname "$0")" || exit 1
( sleep 1
  if command -v open >/dev/null 2>&1; then open "http://localhost:7880/"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:7880/"
  fi ) &
exec node server.js
