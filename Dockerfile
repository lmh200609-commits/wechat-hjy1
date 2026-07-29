FROM node:24-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ \
  && npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
