FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY kgs/package.json kgs/package.json
COPY Tinyurl-api/package.json Tinyurl-api/package.json
RUN npm ci

COPY shared shared
COPY kgs kgs
RUN npm run build --workspace=shared
RUN npm run build --workspace=kgs

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/kgs ./kgs

WORKDIR /app/kgs
EXPOSE 8081
CMD ["node", "dist/server.js"]
