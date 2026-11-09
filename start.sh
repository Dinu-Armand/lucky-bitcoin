#!/usr/bin/env bash
# Lucky Bitcoin - ALL IN ONE (macOS / Linux): ./start.sh -> aplicatia completa pe http://localhost:4000 (Ctrl+C opreste)
set -e
cd "$(dirname "$0")"

[ -f backend/.env ] || { cp backend/.env.example backend/.env; echo "Am creat backend/.env - verifica DATABASE_URL (parola PostgreSQL)."; }
[ -d backend/node_modules ] || (cd backend && npm install)
[ -d frontend/node_modules ] || (cd frontend && npm install)

echo "Construiesc interfata web..."
(cd frontend && npm run build)

(
  for _ in $(seq 1 120); do
    if curl -s -o /dev/null http://localhost:4000/api/health; then
      ( command -v xdg-open >/dev/null && xdg-open http://localhost:4000 ) || ( command -v open >/dev/null && open http://localhost:4000 ) || true
      exit 0
    fi
    sleep 1
  done
) &

echo "Pornesc Lucky Bitcoin pe http://localhost:4000"
cd backend && exec npm start
