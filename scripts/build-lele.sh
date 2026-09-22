#!/usr/bin/env bash
#
# Build UkeFriend for a password-protected netcup webspace at /lele/ and
# package it as a zip ready to upload.
#
#   ./scripts/build-lele.sh
#   LELE_USER=me LELE_PASSWORD='something' ./scripts/build-lele.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${LELE_BASE:-/lele/}"
USERNAME="${LELE_USER:-lele}"
# No default password. This repository is public, so a hardcoded default would
# be a documented way into anyone's deployment — it would lock out nobody.
# A random one is generated instead and printed at the end.
PASSWORD="${LELE_PASSWORD:-}"
STAGE="$(mktemp -d)"
OUT="ukefriend-lele.zip"

if [ -z "$PASSWORD" ]; then
  # `tr </dev/urandom | head -c 16` looks tidier but deadlocks under
  # `set -o pipefail`: head exits at 16 bytes, tr takes SIGPIPE, and the
  # pipeline's failure kills the script silently. Read a fixed amount first.
  PASSWORD="$(head -c 256 /dev/urandom | LC_ALL=C tr -dc 'a-z0-9' | cut -c1-16)"
  GENERATED=1
else
  GENERATED=0
fi

trap 'rm -rf "$STAGE"' EXIT

echo "==> Building for ${BASE} with the service worker disabled"
# DISABLE_PWA keeps the bundle free of sw.js, workbox and the manifest, so a
# password-protected deployment caches nothing on the device.
rm -rf dist
DISABLE_PWA=1 BASE_PATH="$BASE" npm run build

echo "==> Staging deploy files"
cp -r dist/. "$STAGE/"
cp deploy/lele/.htaccess "$STAGE/.htaccess"
cp deploy/lele/robots.txt "$STAGE/robots.txt"
cp deploy/whereami.php "$STAGE/whereami.php"

echo "==> Generating .htpasswd for user '${USERNAME}'"
if command -v htpasswd >/dev/null 2>&1; then
  htpasswd -cbB "$STAGE/.htpasswd" "$USERNAME" "$PASSWORD" >/dev/null 2>&1
else
  # Fall back to Python's bcrypt-compatible crypt if apache2-utils is absent.
  python3 - "$STAGE/.htpasswd" "$USERNAME" "$PASSWORD" <<'PY'
import sys, crypt
path, user, password = sys.argv[1:4]
hashed = crypt.crypt(password, crypt.mksalt(crypt.METHOD_SHA512))
open(path, 'w').write(f"{user}:{hashed}\n")
PY
fi

echo "==> Zipping"
rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OLDPWD/$OUT" . -x '.DS_Store' )

echo
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "  user:     $USERNAME"
echo "  password: $PASSWORD"
if [ "$GENERATED" = "1" ]; then
  echo "            (randomly generated — write it down, it is not stored anywhere else)"
fi
echo
echo "Upload the contents into the 'lele' folder of your document root, then"
echo "set AuthUserFile in .htaccess using whereami.php, and delete whereami.php."
