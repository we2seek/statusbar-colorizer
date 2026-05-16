#!/usr/bin/env bash
set -euo pipefail

source .env

REPO="we2seek/statusbar-colorizer"

# Derive default tag from package.json version
DEFAULT_TAG="v$(node -p "require('./package.json').version")"

read -rp "Tag [$DEFAULT_TAG]: " TAG
TAG="${TAG:-$DEFAULT_TAG}"

# Derive default .vsix filename from tag
DEFAULT_VSIX="statusbar-colorizer-${TAG#v}.vsix"

read -rp "VSIX file [$DEFAULT_VSIX]: " VSIX
VSIX="${VSIX:-$DEFAULT_VSIX}"

read -rp "Release description: " DESCRIPTION

echo ""
echo "  Repo: $REPO"
echo "  Tag:  $TAG"
echo "  VSIX: $VSIX"
echo "  Desc: $DESCRIPTION"
read -rp "Proceed? [y/N] " CONFIRM
if [[ "$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]')" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

# Create the release
RELEASE_ID=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/$REPO/releases \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"$TAG\",\"body\":\"$DESCRIPTION\"}" \
  | grep '"id"' | head -1 | tr -d ' "id:,')

echo "Created release ID: $RELEASE_ID"

# Upload the .vsix asset
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$VSIX" \
  --data-binary @"$VSIX"

echo "Done."
