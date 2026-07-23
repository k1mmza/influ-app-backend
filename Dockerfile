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

# No migrations here. `prisma migrate deploy` is run as a separate,
# individually-approved step (migrate.sh) before this container is (re)started.
CMD ["node", "dist/src/main.js"]
