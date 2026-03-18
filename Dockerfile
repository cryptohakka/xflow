FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx tsc --outDir dist || true
EXPOSE 3010
CMD ["node", "--no-deprecation", "--experimental-vm-modules", "node_modules/.bin/tsx", "src/server.ts"]
