# syntax=docker/dockerfile:1

FROM node:20-alpine

WORKDIR /app

COPY . .

ENV NODE_ENV=production

ENTRYPOINT ["node", "src/index.js"]
