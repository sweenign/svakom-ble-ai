# Use Node.js 22 Alpine (small, fast, secure)
FROM node:22-alpine

WORKDIR /app

# Copy dependency files first (layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy the rest of the app
COPY . .

# Railway sets PORT automatically
EXPOSE 3000

# Start the bridge server
CMD ["node", "bridge/index.js"]
