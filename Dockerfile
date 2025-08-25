# Production Dockerfile for Railway
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NPM_CONFIG_PRODUCTION=true
ENV NPM_CONFIG_OMIT=dev

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production --ignore-scripts

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
