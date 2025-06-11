# Step 1: Build React frontend
FROM node:18 AS frontend-build

WORKDIR /app

# Copy actual frontend source files (not folder name)
COPY UI/binance ./frontend

WORKDIR /app/frontend
RUN npm install
RUN npm run build

# Step 2: Build backend and serve frontend
FROM node:18

WORKDIR /app

# Install pm2 globally
RUN npm install -g pm2

# Copy backend files
COPY Backend ./backend

# Copy React build output to backend/public for Express to serve
COPY --from=frontend-build /app/frontend/build ./backend/public

WORKDIR /app/backend

# Install backend dependencies
RUN npm install

EXPOSE 5000

# Run both Express and bot with PM2
CMD pm2 start index.js --name api && pm2 start botrunner.js --name bot && pm2-runtime
