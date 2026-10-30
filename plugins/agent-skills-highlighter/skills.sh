# Agent Skills Highlighter: reads the skill files on this computer. The manifest runs this text as `sh -c`; it is the one program the plugin declares.
# It only reads: it writes no file, makes no network call and runs nothing that it reads. File and folder names are only ever used as paths.
# Standard input: one line, the optional extra folder (a full path, or ~/...).
# Standard output, for each SKILL.md: a line "@@@", a tab, the kind (user, extra or plugin), a tab, the plugin's name (plugin only), a tab and
# the skill's folder name; then the `name` and `description` lines of its frontmatter, and nothing else of the file.
# Limits: 400 files, and reading a file stops at the first line that would take its output past 2,000 bytes (a line is printed whole or not at all).
# Anything unreadable is skipped without a word.
IFS= read -r extra || :
case $extra in "~/"*) extra=$HOME/${extra#"~/"} ;; esac
case $extra in /*) ;; *) extra= ;; esac
base=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
case $base in /*) ;; *) exit 0 ;; esac
count=0
nl='
'
# read_dir KIND PLUGIN DIR: the SKILL.md of every folder in DIR
read_dir() {
  for file in "$3"/*/SKILL.md; do
    [ -f "$file" ] && [ -r "$file" ] || continue
    [ "$count" -lt 400 ] || return 0
    count=$((count + 1))
    folder=${file%/SKILL.md}
    printf '@@@\t%s\t%s\t%s\n' "$1" "$2" "${folder##*/}"
    LC_ALL=C awk '
      function out(line) { total += length(line) + 1; if (total > 2000) exit; print line }
      { sub(/\r$/, "") }
      NR == 1 { if ($0 !~ /^---[ \t]*$/) exit; next }
      NR > 80 || /^---[ \t]*$/ { exit }
      /^[A-Za-z0-9_-]+:/ { keep = ($0 ~ /^(name|description):/); if (keep) out($0); next }
      keep && (/^[ \t]/ || $0 == "") { out($0) }
    ' "$file" 2>/dev/null
  done
}
read_dir user "" "$base/skills"
if [ -n "$extra" ]; then read_dir extra "" "$extra"; fi
# The installed Claude Code plugins: each install's folder is named in installed_plugins.json, and its skills are in skills/ there.
list=$base/plugins/installed_plugins.json
roots=
if [ -r "$list" ]; then
  roots=$(grep -o '"installPath"[[:space:]]*:[[:space:]]*"[^"]*"' "$list" 2>/dev/null | sed 's/^[^:]*:[[:space:]]*"//; s/"$//')
fi
seen=$nl
while IFS= read -r root; do
  case $root in /*) ;; *) continue ;; esac
  case $seen in *"$nl$root$nl"*) continue ;; esac
  seen=$seen$root$nl
  plugin=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[A-Za-z0-9._-]*"' "$root/.claude-plugin/plugin.json" 2>/dev/null | head -n 1 | sed 's/^[^:]*:[[:space:]]*"//; s/"$//')
  if [ -z "$plugin" ]; then
    plugin=${root%/}
    plugin=${plugin%/*}
    plugin=${plugin##*/}
  fi
  read_dir plugin "$plugin" "$root/skills"
done <<EOF
$roots
EOF
exit 0
