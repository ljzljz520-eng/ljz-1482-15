# 后端镜像（monorepo 根为构建上下文，需要 @timeline/core workspace）
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
COPY packages/core/package.json ./packages/core/
COPY backend/package.json ./backend/
RUN npm install
COPY packages/core ./packages/core
COPY backend ./backend
RUN npm run build -w @timeline/core \
  && npm run prisma:generate -w backend \
  && npm run build -w backend

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 全量 node_modules（含 prisma / tsx，供容器启动时 db push + 触发器 + seed）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/entrypoint.sh ./backend/entrypoint.sh
RUN chmod +x ./backend/entrypoint.sh
WORKDIR /app/backend
EXPOSE 3001
CMD ["sh", "entrypoint.sh"]
