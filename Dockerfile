# Step 1: Build React frontend
FROM node:18 AS frontend-build

WORKDIR /app/frontend

# Copy frontend files (from UI/binance/)
COPY UI/binance/ .

# Install and build React frontend
RUN npm install
RUN npm run build

# Step 2: Setup backend and serve frontend
FROM node:18

WORKDIR /app

# Install PM2 globally
RUN npm install 

# Copy backend files (from lowercase 'backend' folder)
COPY backend/ ./backend/

# Copy built React app to backend/public
COPY --from=frontend-build /app/frontend/dist ./backend/public

WORKDIR /app/backend

# Install backend dependencies
RUN npm install

EXPOSE 5000

# Start index.js and botrunner.js using PM2
CMD start index.js 
