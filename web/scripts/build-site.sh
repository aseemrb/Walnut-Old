#!/bin/bash
# Builds the browser version of Walnut into web/dist.
#   1. installs the JVM core into the local Maven repository (tests skipped, run them separately)
#   2. compiles the core to JavaScript with TeaVM
#   3. bundles the default library files and copies the static site
# Usage: web/scripts/build-site.sh [--wasm]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET=JAVASCRIPT
if [[ "${1:-}" == "--wasm" ]]; then TARGET=WEBASSEMBLY_GC; fi

cd "$ROOT"
./mvnw -q install -DskipTests -Pfat-jar
./mvnw -q -f web/pom.xml clean install -Dteavm.target="$TARGET"

DIST="$ROOT/web/dist"
rm -rf "$DIST"
mkdir -p "$DIST"
cp web/site/*.html web/site/*.css web/site/*.js "$DIST/"
cp web/app/target/site/* "$DIST/"
node web/scripts/bundle-library.mjs "$DIST/library.json"
touch "$DIST/.nojekyll"
echo "Site built in $DIST"
