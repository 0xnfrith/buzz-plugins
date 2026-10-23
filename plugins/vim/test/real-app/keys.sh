#!/bin/bash
# keys.sh OUTDIR LABEL SCENARIO...: key -> paint in the real app, measured by the probe plugin (plugins/key-probe/), one JSON per scenario.
#   first-j      Vim mode on.  Restart the app, enter the long channel ([ then ], by key), gg, then j x100, one key per 120 ms;
#                FIRST_J_RUNS times (3), one file each.
#   first-scroll   Vim mode off or on.  Enter the long channel cold (a click on each channel), click the message list,
#                then the host's own Up arrow x100 (it scrolls the list back through its history), the control for first-j.
#   typing       either.  Click the message box, type 73 characters, one per 100 ms, then clear the box.
#   normal       Vim mode on.  i, type a line, Esc, then w b 0 $ x50 each (one key per 80 ms), then clear the box.
# The Vim plugin's own trace stays Off (the probe is the measurement). Run with the app otherwise idle, on the same
# window size and layout each time; click places are in the variables below.
#   plugins/vim/test/real-app/keys.sh /tmp/before on first-j typing normal
#   plugins/vim/test/real-app/keys.sh /tmp/before off first-scroll typing
. "$(dirname "$0")/lib.sh"
out=$1; label=$2; shift 2
# Where things are, in screen pixels (the window at 0,0, 1200x800). CH_A is a short channel, CH_B the long one.
CH_A=${CH_A:-128 363}; CH_B=${CH_B:-128 394}; LIST=${LIST:-700 300}; BOX=${BOX:-700 700}
mkdir -p "$out"
click() { xdotool mousemove $1 $2 click 1; sleep "${3:-1.5}"; }
cold_by_keys() { xdotool key --delay 200 Escape bracketleft; sleep 3; xdotool key --delay 200 bracketright; sleep 4; }
cold_by_clicks() { click $CH_A 3; click $CH_B 5; }
clear_box() { xdotool key --delay 150 ctrl+a BackSpace; sleep 0.5; }
focus_app
for scenario in "$@"; do
  f="$out/$label-$scenario.json"
  case $scenario in
    first-j)
      # A list is coldest right after the app starts, so each run restarts the app (FIRST_J_RUNS times, default 3; the first
      # keys are slow by a different amount each time, so compare the runs' medians, not one run). COLD=keys skips the restart.
      for run in $(seq "${FIRST_J_RUNS:-3}"); do
        [ "${COLD:-restart}" = restart ] && { restart_app; focus_app; }
        cold_by_keys; xdotool key --delay 200 g g; sleep 2
        probe_reset
        xdotool key --delay 120 $(repeat j 100); sleep 1
        probe_dump "$out/$label-first-j-$run.json"; python3 "$HERE/summary.py" keys "$out/$label-first-j-$run.json"
      done
      continue ;;
    first-scroll)
      cold_by_clicks; click $LIST 1; xdotool mousemove "$PARK_X" "$PARK_Y"
      probe_reset
      xdotool key --delay 120 $(repeat Up 100); sleep 1
      probe_dump "$f" ;;
    typing)
      click $BOX 1; xdotool mousemove "$PARK_X" "$PARK_Y"
      probe_reset
      xdotool type --delay 100 "the quick brown fox jumps over the lazy dog and keeps on running far away"; sleep 1
      probe_dump "$f"; clear_box ;;
    normal)
      xdotool key --delay 200 Escape i; sleep 1
      xdotool type --delay 100 "the quick brown fox jumps over the lazy dog"; sleep 0.5
      xdotool key --delay 200 Escape; sleep 0.5
      probe_reset
      for r in $(seq 50); do xdotool key --delay 80 w b 0 dollar; done; sleep 1
      probe_dump "$f"
      xdotool key --delay 200 i; clear_box; xdotool key --delay 200 Escape Escape ;;
    *) echo "unknown scenario $scenario" >&2; exit 1 ;;
  esac
  python3 "$HERE/summary.py" keys "$f"
done
