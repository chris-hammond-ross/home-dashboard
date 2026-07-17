# Home Dashboard — single image: server + built frontend.
# TODO(optimize): switch runtime stage to `pnpm deploy --prod` output to shrink the image.

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
ENV STATIC_DIR=/app/apps/web/dist
EXPOSE 8090
CMD ["node", "apps/server/dist/index.js"]
