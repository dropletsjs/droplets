FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DROPLETS_URL=http://localhost:8000
ENV VITE_DROPLETS_URL=$VITE_DROPLETS_URL
RUN npm run build

FROM nginx:1.27-alpine
# A template: the image writes conf.d/default.conf from it at start.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV SHOP_PUBLIC_URL=http://localhost:8004
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
