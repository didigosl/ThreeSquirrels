#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-root@8.220.74.149}"
DEPLOY_DIR="${DEPLOY_DIR:-/root/ThreeSquirrels}"
BACKUP_DIR="${BACKUP_DIR:-/root/ThreeSquirrels-code-backups}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://threesquirrels.didigo.es/api/health}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no)
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-15}"
HEALTHCHECK_INTERVAL="${HEALTHCHECK_INTERVAL:-2}"

timestamp="$(date +%Y%m%d-%H%M%S)"
version_date="$(date +%Y%m%d)"

echo "==> 更新正式版本号 v$version_date"
cat > "$ROOT_DIR/version.js" <<EOF
window.APP_VERSION = 'v$version_date';
EOF

echo "==> 正式环境备份"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" \
  "mkdir -p '$BACKUP_DIR' && tar -czf '$BACKUP_DIR/ThreeSquirrels-$timestamp.tar.gz' -C \"$(dirname "$DEPLOY_DIR")\" \"$(basename "$DEPLOY_DIR")\" && echo 'backup: $BACKUP_DIR/ThreeSquirrels-$timestamp.tar.gz'"

echo "==> 同步代码到 $DEPLOY_HOST:$DEPLOY_DIR"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]} -o ServerAliveInterval=5 -o ServerAliveCountMax=3" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'server/node_modules/' \
  --exclude 'uploads/' \
  --exclude '.vercel/' \
  --exclude '.dbg/' \
  --exclude 'debug-*.md' \
  --exclude '.trae*' \
  --exclude 'server/certs/' \
  "$ROOT_DIR/" "$DEPLOY_HOST:$DEPLOY_DIR/"

echo "==> 重建并启动正式服务"
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "
  git config --global --add safe.directory '$DEPLOY_DIR' >/dev/null 2>&1 || true
  cd '$DEPLOY_DIR'
  mkdir -p /root/ThreeSquirrels/.well-known/acme-challenge
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal/threesquirrels.didigo.es.conf <<'EOF'
$(cat "$ROOT_DIR/server/certbot-renewal.conf")
EOF
  install -m 0755 '$DEPLOY_DIR/server/certbot-deploy-hook.sh' /etc/letsencrypt/renewal-hooks/deploy/threesquirrels-nginx-reload
  docker compose up -d --build ts-server ts-nginx
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | sed -n '1,10p'
"

echo "==> 健康检查"
for ((i = 1; i <= HEALTHCHECK_RETRIES; i++)); do
  if curl -fsS "$HEALTHCHECK_URL"; then
    echo
    echo "==> 发布完成: $HEALTHCHECK_URL"
    exit 0
  fi
  if [[ "$i" -lt "$HEALTHCHECK_RETRIES" ]]; then
    echo "healthcheck 重试 $i/$HEALTHCHECK_RETRIES，等待 ${HEALTHCHECK_INTERVAL}s..."
    sleep "$HEALTHCHECK_INTERVAL"
  fi
done

echo
echo "==> 发布失败: 健康检查未通过 $HEALTHCHECK_URL" >&2
exit 1
