FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json .
RUN npm install --production
FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/app.js"]
