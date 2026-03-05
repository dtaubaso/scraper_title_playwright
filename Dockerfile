# Build Environment: Node + Playwright
FROM mcr.microsoft.com/playwright:v1.48.1-focal

RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

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
# Xvfb arranca un display virtual :99 para que Playwright corra headless:false sin monitor real
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & sleep 1 && DISPLAY=:99 node index.js"]