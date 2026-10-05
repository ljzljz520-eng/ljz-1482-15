# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN npm config set registry https://registry.npmmirror.com

# 先拷贝共享包并构建（后端通过 file:../shared 依赖）
COPY shared /shared
RUN cd /shared && npm install && npm run build && npm test

COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat postgresql-client
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /shared/node_modules /shared/node_modules
COPY --from=builder /shared/dist /shared/dist
COPY --from=builder /shared/package.json /shared/package.json
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8000
CMD ["./docker-entrypoint.sh", "api"]
