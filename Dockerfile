FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# nest sourceRoot=src → build output is dist/src/main.js, NOT dist/main.js.
ENV PORT=3001
EXPOSE 3001

# Container-level readiness signal for `docker ps`/`docker inspect`. Hits the
# readiness endpoint (DB + Redis gate); exit 0 only on HTTP 200. Uses node (no
# curl/wget dependency in the alpine base). start-period covers Nest boot time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# No migrations here. `prisma migrate deploy` is run as a separate,
# individually-approved step (migrate.sh) before this container is (re)started.
CMD ["node", "dist/src/main.js"]
