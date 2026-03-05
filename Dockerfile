# Estágio 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependências necessárias para compilação
RUN apk add --no-cache python3 make g++

# Copiar arquivos de definição de pacotes
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/

# Instalar todas as dependências (incluindo devDependencies para o build)
RUN npm install

# Copiar o restante do código
COPY . .

# Gerar o cliente Prisma
RUN npm run prisma:generate

# Buildar o projeto (executa build em todos os workspaces)
# VITE_API_URL vazio para usar caminhos relativos se o frontend for servido pela API
RUN npm run build:panel

# Estágio 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV SERVE_WEB_STATIC=true

# Copiar apenas o necessário para rodar
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package*.json ./apps/api/
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/web/package*.json ./apps/web/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/

# Expor a porta da API
EXPOSE 3333

# Comando de inicialização
# Usamos o script start:panel que já configura as variáveis necessárias
CMD ["npm", "run", "start:panel"]
