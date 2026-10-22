# 构建：docker build -t juanwang .   运行：docker run -p 3000:3000 -v juanwang-data:/app/server/data juanwang
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json vitest.config.ts ./
COPY shared shared
COPY server server
COPY client client
COPY assets assets
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/shared/data shared/data
RUN mkdir -p server/data
VOLUME /app/server/data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
