.PHONY: all build build-program build-sdk build-dashboard build-services test deploy demo clean check docker-build docker-up docker-down

all: build

build:
	bun run build:all

build-program:
	anchor build

build-sdk:
	bun run build:sdk

build-dashboard:
	bun run build:dashboard

build-services:
	bun run build:services

test:
	anchor test

deploy:
	bash scripts/deploy-devnet.sh

demo:
	bun run scripts/seed-demo.ts

check:
	bash scripts/check-env.sh

docker-build:
	docker compose -f services/docker-compose.yml build

docker-up:
	docker compose -f services/docker-compose.yml --env-file .env up -d

docker-down:
	docker compose -f services/docker-compose.yml down

clean:
	rm -rf target sdk/dist dashboard/.next services/*/dist logs
