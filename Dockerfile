# STEP 1: Build React frontend using Vite
FROM node:18 AS frontend-build

WORKDIR /app/frontend

# Copy frontend code
COPY "UI Binance"/ ./

# Install and build
RUN npm install
RUN npm run build

# STEP 2: Setup backend and serve frontend
FROM node:18

WORKDIR /app

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend to backend/public
COPY --from=frontend-build /app/frontend/dist ./backend/public

WORKDIR /app/backend

# Install backend dependencies
RUN npm install

# Expose port
EXPOSE 5000

# Start server using plain Node
CMD ["node", "index.js"]
