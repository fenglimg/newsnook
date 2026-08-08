#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
site_dir=/opt/1panel/www/sites/horizon.241412.xyz/index

cd "$repo_dir"
git fetch upstream main
git rebase upstream/main
docker run --rm -v "$repo_dir:/app" -w /app node:22 npm ci
docker run --rm -v "$repo_dir:/app" -w /app node:22 npm run build
cp -a dist/. "$site_dir/"
chmod -R a+rX "$site_dir"
docker exec 1Panel-openresty-ThbI nginx -t
docker exec 1Panel-openresty-ThbI nginx -s reload
