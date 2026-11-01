# ---- build
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- serve
FROM nginx:1.27-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
# nginx.conf and security-headers.conf are mounted from ../deploy by docker-compose
EXPOSE 8080
