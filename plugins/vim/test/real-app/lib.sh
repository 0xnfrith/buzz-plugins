#!/bin/bash
# Shared by the real-app scripts (see README.md). Needs the Buzz desktop app on an X display, xdotool, xclip, scrot.
# Defaults are the test VM's: Xvfb :99, the app's window at 0,0, 1200x800.
export DISPLAY=${DISPLAY:-:99}
[ -n "${BUZZ_SESSION_ENV:-}" ] && [ -f "$BUZZ_SESSION_ENV" ] && . "$BUZZ_SESSION_ENV"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export PARK_X=${PARK_X:-150} PARK_Y=${PARK_Y:-650}   # where the pointer rests: over no message, so no tooltip eats a key

window() { xdotool search --name '^Buzz$' | head -1; }
focus_app() { xdotool windowfocus "$(window)"; xdotool mousemove "$PARK_X" "$PARK_Y"; }
# repeat WORD N -> "WORD WORD ..." for xdotool key
repeat() { local out="" i; for ((i = 0; i < $2; i++)); do out="$out $1"; done; echo $out; }
# The probe's chords (plugins/key-probe/plugin.js).
probe_reset() { xdotool key ctrl+alt+shift+x; sleep 0.5; }
probe_dump() {  # probe_dump FILE
  xclip -selection clipboard < /dev/null
  xdotool key ctrl+alt+shift+d; sleep 1
  xclip -o -selection clipboard > "$1"
}
# The page process's resident set, in KB (WebKitGTK's web process), and the app's own process.
page_rss() { ps -C WebKitWebProces -o rss= | head -1 | tr -d ' '; }
host_rss() { ps -C buzz-foundation -o rss= | head -1 | tr -d ' '; }

# Quit the app and start it again (the START_BUZZ script brings up Xvfb, the session bus and the keyring if they are not there, then the
# app) and wait for its window and a first paint. Installed plugins and their settings persist; a "Ready to update!" toast may show.
restart_app() {
  pkill -x buzz-foundation; sleep 4
  # Detached with every descriptor closed, so a pipe the caller holds (run.sh | tee) is not kept open by the app.
  setsid -f "${START_BUZZ:?set START_BUZZ to a script that starts the app}" >/dev/null 2>&1 </dev/null
  sleep 3
  for _ in $(seq 30); do [ -n "$(window)" ] && break; sleep 1; done
  sleep "${RESTART_SETTLE:-25}"
}
