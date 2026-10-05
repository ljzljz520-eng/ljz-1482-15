#!/bin/sh
set -e

# 等待数据库就绪
echo "等待数据库 ${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432} ..."
until pg_isready -h "${POSTGRES_HOST:-db}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-timeline}" >/dev/null 2>&1; do
  sleep 1
done
echo "数据库已就绪。"

ROLE="${1:-api}"

if [ "$ROLE" = "worker" ]; then
  # worker 不做 schema 初始化与种子（避免与 API 启动竞态）；仅等待 API 完成建表
  echo "工作线程等待 schema 就绪 ..."
  until echo "SELECT 1 FROM \"Project\" LIMIT 1;" | npx prisma db execute --schema prisma/schema.prisma --stdin >/dev/null 2>&1; do
    sleep 1
  done
  echo "schema 已就绪，启动渲染工作线程..."
  exec node dist/worker.js
fi

# 仅 API 角色负责 schema 同步与种子（幂等）
echo "同步数据库 schema ..."
npx prisma db push --skip-generate --accept-data-loss

echo "写入种子数据（幂等）..."
./node_modules/.bin/tsx prisma/seed.ts || echo "seed 跳过（可能已存在）"

echo "启动 API 服务..."
exec node dist/server.js
