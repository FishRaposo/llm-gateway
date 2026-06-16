NPM := npm

.PHONY: install dev test lint format typecheck build docker-up docker-down demo \
        benchmark clean setup help

install: ## Install dependencies
	$(NPM) ci

dev: ## Start the development server (tsx watch)
	npx tsx watch src/index.ts

test: ## Run the vitest test suite
	npx vitest run

lint: ## Type-check + ESLint
	npx tsc --noEmit
	npx eslint . --max-warnings 50

format: ## Auto-fix lint issues
	npx eslint . --fix

typecheck: ## TypeScript type check only
	npx tsc --noEmit

build: ## Compile TypeScript to dist/
	npx tsc

docker-up: ## Start Redis + gateway
	docker compose up -d

docker-down: ## Stop all containers
	docker compose down

demo: ## Build the gateway and print a sample request
	@echo "Starting LLM Gateway demo..."
	@docker compose up -d redis
	@$(NPM) run build
	@echo "Gateway built. Start it with: node dist/index.js"
	@echo "Sample request:"
	@echo "  curl -X POST http://localhost:3000/v1/chat/completions \\"
	@echo "    -H 'Content-Type: application/json' -H 'Authorization: Bearer demo-key' \\"
	@echo "    -d '{\"model\": \"mock\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'"

benchmark: ## Run the benchmark script
	npx tsx scripts/benchmark.ts

clean: ## Remove build artifacts
	rm -rf dist/ node_modules/.cache/

setup: install build ## First-time setup

help: ## Show this help message
	@echo "LLM Gateway targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
