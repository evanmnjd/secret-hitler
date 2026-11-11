#!/bin/bash
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24.12 or newer, then open this launcher again."
  read -r -p "Press Return to close. "
  exit 1
fi
if ! node -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>24||(v[0]===24&&v[1]>=12)?0:1)'; then
  echo "This test setup needs Node.js 24.12 or newer. Update Node.js and try again."
  read -r -p "Press Return to close. "
  exit 1
fi
if ! command -v corepack >/dev/null 2>&1; then
  echo "Install Corepack once with: npm install --global corepack"
  read -r -p "Press Return to close. "
  exit 1
fi

corepack pnpm local:launch
local_test_launch_exit=$?
if [ "$local_test_launch_exit" -ne 0 ]; then
  echo "Startup did not complete. The message above explains what needs attention."
  read -r -p "Press Return to close. "
fi
exit "$local_test_launch_exit"
