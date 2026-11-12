FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV HOST=0.0.0.0
ENV PORT=8006
# SvelteKit checks form posts against adapter-node's ORIGIN, the proxied
# paths included: the image's own address, which compose replaces by WEB_URL.
ENV ORIGIN=http://localhost:8006
# The shop demo's admin uploads (2 MB images) go through this host's proxy.
ENV BODY_SIZE_LIMIT=4M
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
EXPOSE 8006
CMD ["node", "build"]
