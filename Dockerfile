FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY index.html presentation.html vite.config.js ./
COPY src ./src
COPY scripts/generate-sw.mjs ./scripts/generate-sw.mjs
COPY public ./public
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
