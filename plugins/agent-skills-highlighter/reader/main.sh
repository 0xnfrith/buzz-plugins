A=$1 n=0
IFS= read -r x || :
case $x in "~/"*) x=$HOME/${x#??} ;; esac
case $x in /*) ;; *) x= ;; esac
b=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
case $b in /*) ;; *) exit 0 ;; esac
r() {
  for f in "$3"/*/SKILL.md; do
    [ "$n" -lt 400 ] && [ -f "$f" ] && [ -r "$f" ] || continue
    n=$((n + 1)); g=${f%/SKILL.md}
    printf '@@@\t%s\t%s\t%s\n' "$1" "$2" "${g##*/}"
    LC_ALL=C awk "$A" "$f" 2>/dev/null
  done
}
r user "" "$b/skills"
[ -z "$x" ] || r extra "" "$x"
grep -o '"installPath"[^"]*"[^"]*"' "$b/plugins/installed_plugins.json" 2>/dev/null |
  sed 's/"installPath"[^"]*"//; s/"$//' | awk '!s[$0]++' |
  while IFS= read -r d; do
    case $d in /*) ;; *) continue ;; esac
    d=${d%/}
    p=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[A-Za-z0-9._-]*"' "$d/.claude-plugin/plugin.json" 2>/dev/null | head -n 1 | sed 's/.*"\(.*\)"/\1/')
    [ -n "$p" ] || { p=${d%/*}; p=${p##*/}; }
    r plugin "$p" "$d/skills"
  done
exit 0
