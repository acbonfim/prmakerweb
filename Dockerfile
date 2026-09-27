# Frontend Angular (SPA) servido por nginx no Cloud Run.
#   docker build -t <img> .   (contexto = raiz do repo do front)

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Usa a configuração de produção (fileReplacements -> environment.prod.ts, já com os domínios).
RUN npm run build -- --configuration production

# Robôs (0018): faixas EC2 da AWS em us-west-2 (Oregon), de onde vêm os acessos automatizados ao
# front. Geradas no build a partir da lista oficial da AWS (sempre atual); o build falha se a
# lista não vier, em vez de publicar sem o bloqueio.
FROM alpine:3.20 AS blocklist
RUN apk add --no-cache curl jq \
    && curl -fsSL https://ip-ranges.amazonaws.com/ip-ranges.json \
       | jq -r '.prefixes[] | select(.region == "us-west-2" and .service == "EC2") | "deny \(.ip_prefix);"' \
       | sort -u > /aws-us-west-2-ec2.conf \
    && test "$(wc -l < /aws-us-west-2-ec2.conf)" -gt 10

FROM nginx:1.27-alpine AS final
# Config SPA (fallback para index.html) e porta 8080 exigida pelo Cloud Run.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=blocklist /aws-us-west-2-ec2.conf /etc/nginx/aws-us-west-2-ec2.conf
COPY --from=build /app/dist/prform-app/browser /usr/share/nginx/html
EXPOSE 8080
