FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY Tinyurl-api/package.json Tinyurl-api/package.json
COPY kgs/package.json kgs/package.json
RUN npm ci

COPY shared shared
COPY Tinyurl-api Tinyurl-api
RUN npm run build --workspace=shared
RUN npm run build --workspace=tinyurl-api

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/Tinyurl-api ./Tinyurl-api

WORKDIR /app/Tinyurl-api
EXPOSE 8080
CMD ["node", "dist/server.js"]
