#!/usr/bin/env bash
# Dev helper: restart the server (so freshly-edited code is actually loaded)
# and optionally rebuild the index with real OCR over the sample phone data.
#
#   ./tools/dev-reload.sh          # restart, keep the existing index
#   ./tools/dev-reload.sh --reset  # wipe data/ and re-run OCR over the samples
set -e
PORT="${PORT:-8787}"
RESET="${1:-}"

pkill -f "[n]ode server/server.js" 2>/dev/null || true
sleep 1
if [ "$RESET" = "--reset" ]; then
  rm -rf data
fi

setsid nohup node server/server.js > /tmp/remembers-server.log 2>&1 < /dev/null &
disown 2>/dev/null || true

for _ in $(seq 1 90); do
  sleep 1
  if curl -sf "localhost:$PORT/api/seed/status" 2>/dev/null | grep -q '"stage":"done"'; then
    break
  fi
done

echo "--- server log ---"
tail -n 8 /tmp/remembers-server.log 2>/dev/null || true
echo "--- seed status ---"
curl -s "localhost:$PORT/api/seed/status" || true
echo
