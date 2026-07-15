#!/usr/bin/env bash
# Build and push the Aircrop images to GitHub Container Registry (GHCR).
#
# Prereq (one time):
#   echo 'YOUR_GH_TOKEN' | docker login ghcr.io -u Rayane-Aboud --password-stdin
#   (token needs the write:packages scope)
#
# Usage:
#   ./build-and-push.sh            # builds & pushes backend + frontend
#   ./build-and-push.sh backend    # just one of them
#   ./build-and-push.sh frontend
set -euo pipefail

# GHCR requires the owner to be lowercase.
OWNER="rayane-aboud"
REGISTRY="ghcr.io/${OWNER}"
# OVH nodes are amd64; force it so ARM (Apple Silicon) builds don't crash-loop.
PLATFORM="linux/amd64"

cd "$(dirname "$0")"

build_push() {
  local name="$1" context="$2"
  local image="${REGISTRY}/aircrop-${name}:latest"
  echo ">> Building ${image} (${PLATFORM})"
  docker build --platform "${PLATFORM}" -t "${image}" "${context}"
  echo ">> Pushing ${image}"
  docker push "${image}"
}

target="${1:-all}"
case "${target}" in
  backend)  build_push backend  ./backend  ;;
  frontend) build_push frontend ./frontend ;;
  all)
    build_push backend  ./backend
    build_push frontend ./frontend
    ;;
  *) echo "Unknown target: ${target} (use: backend | frontend | all)"; exit 1 ;;
esac

echo ">> Done. Now deploy:"
echo "   kubectl apply -f k8s/           # picks up Postgres + PVCs + env"
echo "   kubectl rollout restart deployment backend"
echo "   kubectl rollout restart deployment frontend"
