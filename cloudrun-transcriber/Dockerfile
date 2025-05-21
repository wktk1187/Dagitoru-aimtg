FROM node:18-slim

WORKDIR /app
COPY . .

RUN npm install

ENV PATH="/app/node_modules/ffmpeg-static:${PATH}"

EXPOSE 8080

CMD ["node", "index.js"]
