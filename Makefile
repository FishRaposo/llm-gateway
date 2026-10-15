NPM := npm

.PHONY: install dev test lint format typecheck build docker-up docker-down demo demo-ui \
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

demo: ## Offline demo: build, start in mock mode (no keys/.env/Redis), send one request
	$(NPM) run build
	bash scripts/demo.sh

demo-ui: ## Start the dashboard in forced demo mode (no backend)
	cd dashboard && npm run demo:ui

benchmark: ## Run the benchmark script
	npx tsx scripts/benchmark.ts

clean: ## Remove build artifacts
	rm -rf dist/ node_modules/.cache/

setup: install build ## First-time setup

help: ## Show this help message
	@echo "LLM Gateway targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
