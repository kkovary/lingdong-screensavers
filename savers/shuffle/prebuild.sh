#!/bin/bash
# Assemble the shuffle bundle's Resources from every other saver in savers/:
# run each one's own prebuild, copy its Resources into Resources/<id>/, and
# write playlist.json from its saver.conf. Resources/ here is generated.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
savers="$(dirname "$here")"
out="$here/Resources"
rm -rf "$out"; mkdir -p "$out"
entries=()
for d in "$savers"/*/; do
  id="$(basename "$d")"
  [ "$id" = "$(basename "$here")" ] && continue
  [ -f "$d/saver.conf" ] || continue
  if [ -x "$d/prebuild.sh" ]; then "$d/prebuild.sh" >/dev/null; fi
  mkdir -p "$out/$id"
  cp -R "$d/Resources/." "$out/$id/"
  [ -f "$d/UPSTREAM-LICENSE" ] && cp "$d/UPSTREAM-LICENSE" "$out/$id/"
  entry="$(
    unset TITLE INDEX FILE_ACCESS BG
    # shellcheck source=/dev/null
    source "$d/saver.conf"
    script=null; [ -f "$d/Resources/saver.js" ] && script='"saver.js"'
    fa=false; [ "${FILE_ACCESS:-0}" = 1 ] && fa=true
    printf '{"name": "%s", "dir": "%s", "index": "%s", "script": %s, "fileAccess": %s, "background": "%s"}' \
      "$TITLE" "$id" "${INDEX:-index.html}" "$script" "$fa" "${BG:-FFFFFF}"
  )"
  entries+=("$entry")
done
{ printf '[\n  '; (IFS=$'\n'; printf '%s' "${entries[*]}" | sed 's/$/,/; $ s/,$//' | sed '2,$ s/^/  /'); printf '\n]\n'; } > "$out/playlist.json"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('playlist:', ', '.join(p['name'] for p in d))" "$out/playlist.json"
