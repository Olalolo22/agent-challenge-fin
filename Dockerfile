FROM oven/bun:latest

RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install


COPY . .


RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000


CMD ["bun", "src/index.ts"]