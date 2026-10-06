# 前端镜像：在 monorepo 根构建（需要 @timeline/core workspace 源码）
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
COPY packages/core/package.json ./packages/core/
COPY frontend/package.json ./frontend/
RUN npm install
COPY packages/core ./packages/core
COPY frontend ./frontend
RUN npm run build -w frontend

FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
