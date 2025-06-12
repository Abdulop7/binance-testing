# backend/Dockerfile

# Use Node.js base image
FROM node:18

# Set working directory inside container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the backend files
COPY . .

# Expose the port your server listens on
EXPOSE 5000

# Start the server
CMD ["node", "index.js"]
