#!/bin/zsh
set -eu
cd -- "${0:A:h}"
backend="${1:-langgraph}"
if (( $# > 0 )); then shift; fi
exec npm run start -- --backend "$backend" "$@"
