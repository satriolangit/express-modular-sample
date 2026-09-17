#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "════════════════════════════════════════"
echo " 1. Copy extensions dari extension-api"
echo "════════════════════════════════════════"
node scripts/copy-extensions.js

echo ""
echo "════════════════════════════════════════"
echo " 2. Merge package.json"
echo "════════════════════════════════════════"
node scripts/merge-package.js

echo ""
echo "════════════════════════════════════════"
echo " 3. npm install"
echo "════════════════════════════════════════"
npm install

echo ""
echo "════════════════════════════════════════"
echo " 4. Start server"
echo "════════════════════════════════════════"
npm start