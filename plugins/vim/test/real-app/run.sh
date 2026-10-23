#!/bin/bash
# run.sh OUTDIR LABEL [IDLE_SECONDS]: the whole real-app measurement, the same each time (see README.md).
#   1. update the Vim plugin from the work tree and check it is what is installed
#   2. plugin ON:  first-j, first-scroll, typing, normal;  then IDLE_SECONDS (default 900) idle with page-process RSS every 30 s
#   3. plugin OFF: first-scroll, typing;                    then IDLE_SECONDS idle with RSS every 30 s (the control)
#   4. plugin ON again
# Needs the probe installed (plugin.sh install-probe once), the app on a short channel then the long one in the sidebar (see
# keys.sh for the click places), nothing else touching the app or the machine. About 10 minutes plus twice IDLE_SECONDS.
. "$(dirname "$0")/lib.sh"
out=$1; label=$2; idle=${3:-900}
mkdir -p "$out"
"$HERE/plugin.sh" update; "$HERE/check.sh" | tee "$out/$label-installed.txt"
echo "== plugin on"
"$HERE/keys.sh" "$out" "$label-on" first-j first-scroll typing normal | tee "$out/$label-on-keys.txt"
"$HERE/rss.sh" "$out/$label-on-rss.tsv" "$idle" 30 | tee "$out/$label-on-rss.txt"
echo "== plugin off"
"$HERE/plugin.sh" toggle
CH_A=${CH_A_OFF:-128 331} CH_B=${CH_B_OFF:-128 362} "$HERE/keys.sh" "$out" "$label-off" first-scroll typing | tee "$out/$label-off-keys.txt"
"$HERE/rss.sh" "$out/$label-off-rss.tsv" "$idle" 30 | tee "$out/$label-off-rss.txt"
"$HERE/plugin.sh" toggle
echo "== done: $out"
