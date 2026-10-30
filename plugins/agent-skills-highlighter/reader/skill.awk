function out(line) { total += length(line) + 1; if (total > 2000) exit; print line }
{ sub(/\r$/, "") }
NR == 1 { if ($0 !~ /^---[ \t]*$/) exit; next }
NR > 80 || /^---[ \t]*$/ { exit }
/^[A-Za-z0-9_-]+:/ { keep = ($0 ~ /^(name|description):/); if (keep) out($0); next }
keep && (/^[ \t]/ || $0 == "") { out($0) }
