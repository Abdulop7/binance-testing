FROM node:18

WORKDIR /app

# Copy only the package.json and package-lock.json first (for caching + proper install)
COPY backend/package*.json ./

# Install dependencies
RUN npm install

# Now copy the rest of your code
COPY backend/ .

# Run the app
CMD ["node", "index.js"]

