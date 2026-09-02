#!/bin/zsh

project_directory="${0:A:h}"
cd "$project_directory" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Sales Ledger needs Node.js 22 or newer."
  echo "Install Node.js, then double-click this launcher again."
  echo
  read "?Press Return to close this window."
  exit 1
fi

node launcher/server.mjs
launch_status=$?

if (( launch_status != 0 )); then
  echo
  read "?Press Return to close this window."
fi

exit $launch_status
