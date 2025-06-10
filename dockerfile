FROM node:18

WORKDIR /app

# Step 1: Only copy package files first
COPY backend/package.json backend/package-lock.json ./

# Step 2: Install dependencies
RUN npm install

# Step 3: Copy the rest of your code
COPY backend/ .

# Step 4: Define the start command
CMD ["node", "index.js"]
