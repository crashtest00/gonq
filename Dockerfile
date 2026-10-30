# Beta deploy image: the built desktop web frontend at / and the mobile web build at /mobile/, served by nginx.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY packages/editor/package.json packages/editor/
RUN npm ci
COPY . .
RUN npm run build
# The mobile app builds with base /mobile/ once it has a build script (M-07 FE); until then there is no dist to serve.
RUN if [ ! -d apps/mobile/dist ]; then echo "WARNING: apps/mobile/dist missing, /mobile/ will serve nothing"; mkdir -p apps/mobile/dist; fi

FROM nginx:1.27-alpine
COPY --from=build /app/apps/desktop/dist /usr/share/nginx/html
COPY --from=build /app/apps/mobile/dist /usr/share/nginx/html/mobile
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
