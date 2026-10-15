#!/usr/bin/env bash
# Offline demo: start the built gateway with the mock provider (no API keys,
# no .env, no Redis), send one OpenAI-compatible request and print the reply.
# Usage: make demo   (builds first)   or   DEMO_PORT=3005 scripts/demo.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${DEMO_PORT:-3000}"
KEY="demo-key"
BASE="http://localhost:${PORT}"
LOG="$(mktemp -t llm-gateway-demo-log.XXXXXX)"
EMPTY_CONFIG_DIR="$(mktemp -d -t llm-gateway-demo-config.XXXXXX)"

if [ ! -f dist/index.js ]; then
  echo "dist/index.js not found: run 'npm run build' (or 'make demo') first." >&2
  exit 1
fi

if curl -s -o /dev/null "${BASE}/health"; then
  echo "Something is already listening on port ${PORT}. Stop it or set DEMO_PORT." >&2
  exit 1
fi

# Empty provider keys stop dotenv from loading real keys out of a local .env,
# and an empty CONFIG_DIR keeps a local routing.yaml from pointing elsewhere,
# so the demo always runs against the mock provider only.
MOCK_PROVIDER=true \
GATEWAY_API_KEY="${KEY}" \
GATEWAY_PORT="${PORT}" \
DATABASE_PATH=":memory:" \
CONFIG_DIR="${EMPTY_CONFIG_DIR}" \
OPENAI_API_KEY="" ANTHROPIC_API_KEY="" GEMINI_API_KEY="" \
OLLAMA_BASE_URL="" OLLAMA_ENABLED="false" \
  node dist/index.js >"${LOG}" 2>&1 &
GATEWAY_PID=$!

cleanup() {
  kill "${GATEWAY_PID}" 2>/dev/null || true
  rmdir "${EMPTY_CONFIG_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "${BASE}/health"; then break; fi
  if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
    echo "Gateway exited during startup. Log:" >&2
    cat "${LOG}" >&2
    exit 1
  fi
  sleep 0.2
done

echo "Gateway running on ${BASE} in mock mode (log: ${LOG})"
echo
echo "Request:"
echo "  curl -X POST ${BASE}/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' -H 'Authorization: Bearer ${KEY}' \\"
echo "    -d '{\"model\": \"mock\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'"
echo

BODY="$(mktemp -t llm-gateway-demo-body.XXXXXX)"
STATUS="$(curl -s -o "${BODY}" -w '%{http_code}' -X POST "${BASE}/v1/chat/completions" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${KEY}" \
  -d '{"model": "mock", "messages": [{"role": "user", "content": "Hello"}]}')"

echo "Response: HTTP ${STATUS}"
node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");try{console.log(JSON.stringify(JSON.parse(t),null,2))}catch{console.log(t)}' "${BODY}"
rm -f "${BODY}"

if [ "${STATUS}" != "200" ]; then
  echo "Demo failed: expected HTTP 200. Gateway log: ${LOG}" >&2
  exit 1
fi
