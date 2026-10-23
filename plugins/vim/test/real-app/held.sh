#!/bin/bash
# held.sh OUTDIR LABEL SECONDS vim|host: a long run of held keys, with the page process's memory sampled every 30 s.
#   vim   Vim mode on.  Cold start, enter the list (Esc [ ] gg), then, until SECONDS are up, the loop
#         g g j j j k k k G k k k j j j  at one key per 120 ms, inside the rows the page has mounted: the cursor moves on every key.
#   host  The control, Vim mode off (plugin.sh toggle first).  Cold start, a click on the channel and on the list, Home, then
#         Home Down Down Down Up Up Up End Up Up Up Down Down Down  at the same rate: the host's own scrolling.
# Writes OUTDIR/LABEL-rss.tsv and -rss.txt (the summary), -keys.txt (the key batches sent) and screenshots (-start, -mid, -end).
# Run it with nothing else touching the app; about SECONDS plus 1 minute (background it for a long run):
#   setsid nohup plugins/vim/test/real-app/held.sh /tmp/held old 1500 vim >/dev/null 2>&1 </dev/null & disown
. "$(dirname "$0")/lib.sh"
out=$1; label=$2; secs=${3:-1500}; mode=${4:-vim}
mkdir -p "$out"
click() { xdotool mousemove "$1" "$2" click 1; sleep "${3:-1.5}"; }
restart_app; focus_app
case $mode in
  vim)
    xdotool key --delay 200 Escape bracketleft; sleep 3; xdotool key --delay 200 bracketright; sleep 4
    xdotool key --delay 200 g g; sleep 2
    cycle="g g j j j k k k G k k k j j j" ;;
  host)
    click "${CH_OFF:-128 331}" 4; click "${LIST:-700 300}" 1; xdotool mousemove "$PARK_X" "$PARK_Y"
    xdotool key --delay 200 Home; sleep 2
    cycle="Home Down Down Down Up Up Up End Up Up Up Down Down Down" ;;
  *) echo "usage: held.sh OUTDIR LABEL SECONDS vim|host" >&2; exit 1 ;;
esac
scrot -o "$out/$label-start.png"
"$HERE/rss.sh" "$out/$label-rss.tsv" "$secs" 30 > "$out/$label-rss.txt" 2>&1 &
batch=""; for _ in $(seq 20); do batch="$batch $cycle"; done
end=$(( $(date +%s) + secs )); n=0
while [ "$(date +%s)" -lt "$end" ]; do
  xdotool key --delay 120 $batch; n=$((n + 1))
  [ $n -eq 2 ] && scrot -o "$out/$label-mid.png"
done
scrot -o "$out/$label-end.png"
echo "$n batches of $(echo $batch | wc -w) keys" > "$out/$label-keys.txt"
wait
cat "$out/$label-rss.txt" "$out/$label-keys.txt"
