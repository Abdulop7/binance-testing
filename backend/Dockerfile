# Use Node.js base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy dependencies and install
COPY package*.json ./
RUN npm install

# Copy app code
COPY . .

# Set environment port and expose
ENV Port 100
EXPOSE 100

# Start the app
CMD ["node", "index.js"]
