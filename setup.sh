#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or is not on PATH. Install Docker with Compose first." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is unavailable. Install the Docker Compose plugin." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop or the Docker daemon and try again." >&2
  exit 1
fi
if [ ! -f public/data/bible.sqlite ]; then
  echo "The bundled Bible database is missing. Import it as described in README.md." >&2
  exit 1
fi

docker compose -f compose.yaml build
echo "Docker image built. Start it with:"
echo "  docker compose -f compose.yaml up -d --wait"
