FROM node:22-alpine

WORKDIR /usr/src/app

COPY proxy.js .

RUN npm install express axios dotenv

EXPOSE 11434

CMD ["node", "proxy.js"]
