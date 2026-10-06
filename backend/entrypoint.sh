#!/bin/sh
set -e

echo "[entrypoint] 等待 PostgreSQL 就绪…"
node dist/scripts/wait-db.js

echo "[entrypoint] 同步 Prisma schema（db push）…"
npx prisma db push --skip-generate --accept-data-loss

echo "[entrypoint] 安装数据库完整性触发器（拒绝悬空引用）…"
npx prisma db execute --file ./prisma/triggers.sql --schema ./prisma/schema.prisma

echo "[entrypoint] 执行 seed（幂等）…"
node --import tsx prisma/seed.ts

echo "[entrypoint] 启动后端服务…"
exec node dist/server.js
