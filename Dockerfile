FROM node:20-alpine
WORKDIR /app

# Install deps
COPY package.json ./
RUN npm install --production

# Copy app files
COPY server.js ./server.js
COPY public ./public
# If you have an existing data.json in repo, copy it; otherwise server creates one.
COPY data.json ./data.json

ENV PORT=10000
EXPOSE 10000
CMD ["node", "server.js"]
