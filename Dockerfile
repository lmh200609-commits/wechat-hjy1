FROM node:24-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ \
  && npm ci --omit=dev

COPY . .

EXPOSE 80
STOPSIGNAL SIGTERM

CMD ["npm", "start"]
