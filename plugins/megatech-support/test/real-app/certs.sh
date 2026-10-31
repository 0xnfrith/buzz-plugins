#!/usr/bin/env bash
# Makes a throwaway CA and a certificate for support.megatech.invalid signed by it, in $1 (default ./out).
# Used only to point the real desktop app at the fake service on this machine; nothing is installed system-wide. serve.mjs presents
# the certificate; the app is started with SSL_CERT_FILE pointing at a bundle that holds the system roots plus this CA.
set -euo pipefail
out=${1:-"$(dirname "$0")/out"}
mkdir -p "$out"
cd "$out"
[ -f ca.crt ] && exit 0
host=support.megatech.invalid
openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj "/CN=Local test CA (not for real use)" -keyout ca.key -out ca.crt 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=$host" -keyout leaf.key -out leaf.csr 2>/dev/null
printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$host" > leaf.ext
openssl x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 3 -extfile leaf.ext -out leaf.crt 2>/dev/null
cat /etc/ssl/certs/ca-certificates.crt ca.crt > bundle.crt
