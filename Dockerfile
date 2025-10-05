# Use the official Node image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy only package.json first and install deps
COPY package.json ./
RUN npm install --production

# Copy the rest of the app
COPY server.js ./ 

# Expose the port your app listens on
ENV PORT=10000
EXPOSE 10000

# Start the server
CMD ["node", "server.js"]
