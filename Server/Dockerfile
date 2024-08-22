# Use an official node image as the base image
FROM node:18-alpine AS base

# Set the working directory
WORKDIR /src

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install 

# Copy the rest of the application code
COPY . .

# Expose the port the server runs on
EXPOSE 8080

COPY entrypoint.sh /usr/local/bin/

ENTRYPOINT ["entrypoint.sh"]

# Development stage
FROM base AS dev

EXPOSE 8080
CMD ["npm", "run", "dev"]


# Production stage
FROM base AS prod

EXPOSE 8080
CMD ["npm", "start"]
