FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_FILE=/data/db.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY config ./config
COPY scripts ./scripts
EXPOSE 3000
CMD ["node", "src/server.js"]
