FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN mkdir -p subtitles data debug

RUN if [ ! -f .env ]; then cp .env.example .env; fi

EXPOSE 3000

CMD ["node", "index.js"]
