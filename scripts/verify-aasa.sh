#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://luminecklace.com}"
ENDPOINTS=(
  "/.well-known/apple-app-site-association"
  "/apple-app-site-association"
)

for endpoint in "${ENDPOINTS[@]}"; do
  url="${BASE_URL%/}${endpoint}"
  headers_file="$(mktemp)"
  body_file="$(mktemp)"

  curl -sS -D "$headers_file" -o "$body_file" "$url"

  status_code="$(awk 'toupper($1) ~ /^HTTP\// { code=$2 } END { print code }' "$headers_file")"
  content_type="$(awk -F': *' 'BEGIN { IGNORECASE=1 } tolower($1)=="content-type" { gsub("\r", "", $2); value=$2 } END { print value }' "$headers_file")"

  echo "=== ${url} ==="
  echo "status: ${status_code:-N/A}"
  echo "content-type: ${content_type:-N/A}"
  echo "body (first 8 lines):"
  sed -n '1,8p' "$body_file"
  echo

  rm -f "$headers_file" "$body_file"
done
