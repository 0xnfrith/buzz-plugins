#!/bin/bash
# check.sh: what the real app has installed: each plugin's id, whether its code equals the work tree's (Vim mode) and a screenshot.
. "$(dirname "$0")/lib.sh"
python3 - "$HERE" <<'PY'
import json, hashlib, os, sys
here = sys.argv[1]
d = os.path.expanduser('~/.local/share/dev.local.buzz.foundation/profiles/default')
reg = json.load(open(d + '/registry.json'))['installed']
for pid, r in reg.items():
    art = json.load(open(f"{d}/artifacts/{pid}/{r['current']}.json"))
    sha = hashlib.sha256(art['code'].encode()).hexdigest()[:12]
    src = {'megatech.vim-mode': os.path.join(here, '..', '..', 'plugin.js'), 'megatech.key-probe': os.path.join(here, '..', '..', '..', 'key-probe', 'plugin.js')}.get(pid)
    mark = ''
    if src and os.path.exists(src):
        tree = hashlib.sha256(open(src, 'rb').read()).hexdigest()[:12]
        mark = 'MATCHES the work tree' if tree == sha else f'DIFFERS from the work tree ({tree})'
    print(f'{pid}: installed {sha} {mark}')
PY
