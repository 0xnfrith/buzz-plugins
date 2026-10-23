#!/bin/bash
# rss.sh OUT SECONDS [EVERY]: sample the page process's and the app's resident memory (KB) every EVERY seconds (default 30)
# into OUT (one line per sample: epoch pageKB hostKB), then print the summary. Run it with nothing else touching the app.
# Never prints a process's arguments (the app's command line holds a key).
#   long runs:  setsid nohup plugins/vim/test/real-app/rss.sh /tmp/rss-on.tsv 1800 >/dev/null 2>&1 </dev/null & disown; sleep 3
. "$(dirname "$0")/lib.sh"
out=$1; secs=${2:-900}; every=${3:-30}
end=$(( $(date +%s) + secs ))
: > "$out"
while [ "$(date +%s)" -lt "$end" ]; do
  echo "$(date +%s) $(page_rss) $(host_rss)" >> "$out"
  sleep "$every"
done
python3 "$HERE/summary.py" rss "$out"
