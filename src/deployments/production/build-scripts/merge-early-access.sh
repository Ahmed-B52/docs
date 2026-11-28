#!/usr/bin/env sh

# Takes docs-early-access files and merges them into docs-internal
# Assumed that it is being run from the root of the docs-internal repo

# Check the import roots too: assets could itself be a link. Do not follow
# links while scanning, and fail the build if the scan cannot be completed.
links=$(find docs-early-access/assets docs-early-access/content docs-early-access/data \
  -type l -print -quit) || exit 1
if [ -n "$links" ]; then
  echo "Early access imports must not contain symbolic links." >&2
  exit 1
fi

mv docs-early-access/assets/images assets/images/early-access
mv docs-early-access/content content/early-access
mv docs-early-access/data data/early-access
