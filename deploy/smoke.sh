#!/bin/sh
# Verificación rápida de un stack levantado (fase 114): la usan el CI y el despliegue en el servidor.
#   deploy/smoke.sh [dirección]        (por defecto http://localhost:8080)
# Sale con 1 si algo falla. No crea datos; sólo hace un intento de login con credenciales falsas.
set -u

base="${1:-http://localhost:8080}"
fail=0
check() {
  label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "✓ $label"; else echo "✗ $label"; fail=1; fi
}

check "API y base de datos (/health)" sh -c "curl -fsS '$base/health' | grep -q '\"database\":\"ok\"'"
check "index.html con CSP" sh -c "curl -fsSI '$base/' | grep -qi '^content-security-policy:'"
check "configuración de acceso (/api/v1/auth/config)" curl -fsS "$base/api/v1/auth/config"
check "motor del OCR servido por Nginx" curl -fsS -o /dev/null "$base/ocr/worker.min.js"
check "rutas de la SPA caen en index.html" sh -c "curl -fsS '$base/pacientes' | grep -q 'id=\"root\"'"
check "login con credenciales falsas responde 401" sh -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{\"email\":\"nadie@example.com\",\"password\":\"no-es-esta\"}' '$base/api/v1/auth/login')\" = 401"

[ "$fail" -eq 0 ] && echo "Todo bien en $base" || echo "Hay fallas en $base"
exit "$fail"
