NPM := npm

.PHONY: help demo install test lint build dev clean setup benchmark

help:
	@echo "LLM Gateway - Available targets:"
	@echo ""
	@echo "  demo      Quick demo: start gateway, run sample request"
	@echo "  install   Install dependencies"
	@echo "  test      Run vitest tests"
	@echo "  lint      Run TypeScript type check"
	@echo "  build     Compile TypeScript"
	@echo "  dev       Start development server"
	@echo "  clean     Remove build artifacts"
	@echo "  setup     First-time setup"

install:
	$(NPM) ci

test:
	npx vitest run

lint:
	npx tsc --noEmit
	npx eslint . --max-warnings 50

build:
	npx tsc

benchmark:
	npx tsx scripts/benchmark.ts

demo:
	@echo "🚀 Starting LLM Gateway demo..."
	@docker compose up -d redis
	@sleep 2
	@echo "🌐 Starting gateway..."
	@$(NPM) run build
	@node dist/index.js &
	@sleep 2
	@echo "✅ Gateway ready!"
	@echo "   Gateway:   http://localhost:3000"
	@echo "   Admin API: http://localhost:3000/admin"
	@echo ""
	@echo "Test with: curl -X POST http://localhost:3000/v1/chat/completions \\"
	@echo "  -H 'Content-Type: application/json' \\"
	@echo "  -H 'Authorization: Bearer demo-key' \\"
	@echo "  -d '{\"model\": \"mock\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'"
	@echo ""
	@echo "To stop: pkill -f 'node dist/index.js' && docker compose down"

dev:
	npx tsx watch src/index.ts

clean:
	rm -rf dist/ node_modules/.cache/

setup: install build
