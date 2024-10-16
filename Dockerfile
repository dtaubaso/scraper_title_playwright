# Build Environment: Node + Playwright
FROM mcr.microsoft.com/playwright:v1.48.1-focal

RUN apt-get update

# Env
WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

EXPOSE 8080
CMD [ "node", "index.js" ]