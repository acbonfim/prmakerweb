# Frontend Angular (SPA) servido por nginx no Cloud Run.
#   docker build -t <img> .   (contexto = raiz do repo do front)

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Usa a configuração de produção (fileReplacements -> environment.prod.ts, já com os domínios).
RUN npm run build -- --configuration production

FROM nginx:1.27-alpine AS final
# Config SPA (fallback para index.html) e porta 8080 exigida pelo Cloud Run.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/prform-app/browser /usr/share/nginx/html
EXPOSE 8080
