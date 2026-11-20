FROM node:22-bookworm-slim

RUN npm install --global --no-audit --no-fund pnpm@10.33.3
WORKDIR /home/node/app
RUN chown node:node .
USER node

COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile --prod=false && pnpm build

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001

CMD ["pnpm", "--filter", "@brightwork/api", "start"]
