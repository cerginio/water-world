# Requires Node.js 24, npm, GNU Make, and a Tilecraft checkout.
# Runtime npm dependencies: three + lil-gui.
# Build: vite + magic-string. Deploy: netlify-cli. Browser QA: playwright + Chromium.
# Copy .env.example to .env.local once and set TILECRAFT_ROOT there.
# All npm tools are local, installed from package-lock.json by `make deps`.

.DEFAULT_GOAL := help
.PHONY: help deps browsers check-config dev build verify test test-portability preview netlify-login netlify-link deploy-check deploy deploy-prod

help:
	@echo "deps / browsers: install locked npm dependencies / QA browser"
	@echo "dev: local Vite on port 5199; preview: serve standalone dist on port 4173"
	@echo "build: deps -> check-config -> bundle -> verify assets and paths"
	@echo "test: build -> browser QA on standalone production files"
	@echo "test-portability: build in temporary relocated folders, including paths with spaces"
	@echo "netlify-login / netlify-link: authenticate / select existing Netlify site"
	@echo "deploy-check: build and validate deployment command without uploading"
	@echo "deploy: build and upload draft; deploy-prod: build and publish production"
	@echo "Netlify target: NETLIFY_SITE_ID, linked project, or edge-of-elements"

node_modules/.package-lock.json: package.json package-lock.json
	npm ci

deps: node_modules/.package-lock.json

browsers: deps
	npm exec -- playwright install chromium

check-config: deps
	npm run check:config

dev: check-config
	npm run dev

build: check-config
	npm run build

verify: deps
	npm run verify:dist

test: build
	npm run test:build

test-portability: check-config
	npm run test:portability

# Preview deliberately does not depend on Tilecraft or installed npm packages.
preview:
	node scripts/preview.mjs

netlify-login: deps
	npm exec -- netlify login

netlify-link: deps
	npm exec -- netlify link

# Each deploy script builds and verifies once before invoking Netlify CLI.
deploy-check: check-config
	npm run deploy:check

deploy: check-config
	npm run deploy

deploy-prod: check-config
	npm run deploy:prod
