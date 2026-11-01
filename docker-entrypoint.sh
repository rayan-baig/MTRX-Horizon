#!/bin/sh
# Start as root only long enough to hand the data folder to the app's own
# user, then drop to that user before the site starts.
#
# Render mounts the disk owned by root, so a non-root app could not create
# its database there. Running the whole site as root would work, but then
# any bug in it runs with every permission in the container.
set -e

if [ "$(id -u)" = "0" ]; then
  dir="$(dirname "${MTRX_DB_PATH:-/app/data/horizon.db}")"
  mkdir -p "$dir"
  chown -R horizon:horizon "$dir"
  exec setpriv --reuid=horizon --regid=horizon --init-groups "$@"
fi

exec "$@"
