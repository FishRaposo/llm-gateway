#!/usr/bin/env bash
# Offline demo: start the built gateway with the mock provider (no API keys,
# no .env, no Redis), send one OpenAI-compatible request and print the reply.
# Usage: make demo   (builds first)   or   DEMO_PORT=3005 scripts/demo.sh
set -euo pipefail

cd "$(dirname "$0")/.."

KEY="demo-key"
LOG="$(mktemp -t llm-gateway-demo-log.XXXXXX)"
BODY="$(mktemp -t llm-gateway-demo-body.XXXXXX)"
EMPTY_CONFIG_DIR="$(mktemp -d -t llm-gateway-demo-config.XXXXXX)"
GATEWAY_PID=""

port_in_use() {
  curl -s -o /dev/null --max-time 1 "http://localhost:$1/health"
}

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})'
}

cleanup() {
  local status=$?
  if [ -n "${GATEWAY_PID}" ] && kill -0 "${GATEWAY_PID}" 2>/dev/null; then
    kill "${GATEWAY_PID}" 2>/dev/null || true
    # The gateway stops listening on SIGTERM but drains for 10 s before it
    # exits; wait until the port is free so a back-to-back run can reuse it,
    # then stop the process outright (it holds nothing worth draining).
    for _ in $(seq 1 25); do
      port_in_use "${PORT}" || break
      sleep 0.2
    done
    kill -9 "${GATEWAY_PID}" 2>/dev/null || true
    wait "${GATEWAY_PID}" 2>/dev/null || true
  fi
  if [ "${status}" -ne 0 ]; then
    echo "Demo failed (exit ${status})." >&2
    if [ -s "${LOG}" ]; then
      echo "Gateway log:" >&2
      cat "${LOG}" >&2
    fi
  fi
  rm -f "${LOG}" "${BODY}"
  rmdir "${EMPTY_CONFIG_DIR}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT

if [ ! -f dist/index.js ]; then
  echo "dist/index.js not found: run 'npm run build' (or 'make demo') first." >&2
  exit 1
fi

if [ -n "${DEMO_PORT:-}" ]; then
  PORT="${DEMO_PORT}"
  if port_in_use "${PORT}"; then
    echo "Something is already listening on port ${PORT}. Stop it or pick another DEMO_PORT." >&2
    exit 1
  fi
else
  PORT=3000
  if port_in_use "${PORT}"; then
    PORT="$(free_port)"
    echo "Port 3000 is busy; using free port ${PORT}."
  fi
fi
BASE="http://localhost:${PORT}"

# MOCK_PROVIDER=true is explicit so the demo works under any NODE_ENV. Empty
# provider keys stop dotenv from loading real keys out of a local .env, and an
# empty CONFIG_DIR keeps a local routing.yaml from pointing elsewhere, so the
# demo always runs against the mock provider only.
MOCK_PROVIDER=true \
GATEWAY_API_KEY="${KEY}" \
GATEWAY_PORT="${PORT}" \
DATABASE_PATH=":memory:" \
CONFIG_DIR="${EMPTY_CONFIG_DIR}" \
OPENAI_API_KEY="" ANTHROPIC_API_KEY="" GEMINI_API_KEY="" \
OLLAMA_BASE_URL="" OLLAMA_ENABLED="false" \
  node dist/index.js >"${LOG}" 2>&1 &
GATEWAY_PID=$!

for _ in $(seq 1 50); do
  if port_in_use "${PORT}"; then break; fi
  if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
    echo "Gateway exited during startup." >&2
    exit 1
  fi
  sleep 0.2
done

echo "Gateway running on ${BASE} in mock mode"
echo
echo "Request:"
echo "  curl -X POST ${BASE}/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' -H 'Authorization: Bearer ${KEY}' \\"
echo "    -d '{\"model\": \"mock\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'"
echo

STATUS="$(curl -s -o "${BODY}" -w '%{http_code}' -X POST "${BASE}/v1/chat/completions" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${KEY}" \
  -d '{"model": "mock", "messages": [{"role": "user", "content": "Hello"}]}')"

echo "Response: HTTP ${STATUS}"
node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");try{console.log(JSON.stringify(JSON.parse(t),null,2))}catch{console.log(t)}' "${BODY}"

if [ "${STATUS}" != "200" ]; then
  echo "Expected HTTP 200." >&2
  exit 1
fi
