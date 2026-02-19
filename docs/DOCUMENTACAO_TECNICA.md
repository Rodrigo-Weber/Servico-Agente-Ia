# Documentacao Tecnica

## 1. Arquitetura geral
Monorepo com 3 blocos:
1. `apps/api`: backend Fastify + Prisma + jobs + webhooks
2. `apps/web`: frontend React + TypeScript + Vite
3. `packages/shared`: pacote compartilhado

Banco: MySQL (cloud)
IA: Groq
Canal WhatsApp: Evolution API

## 2. Modulos principais (API)
1. `auth`: login, refresh, logout, guardas de autenticacao e role
2. `admin`: empresas, numeros autorizados, prompts, WhatsApp, monitoramento global
3. `company`: dados da empresa, certificado A1, dashboard, NF-e, monitoramento da empresa
4. `webhooks`: entrada de mensagens/eventos da Evolution
5. `jobs`: scheduler e rotina de sync DF-e
6. `services`: IA, Evolution, sync DF-e, importacao de XML

## 3. Fluxo de dados de NF-e
1. Worker roda `runHourlyNfeSync`
2. Filtra apenas empresas:
- ativas
- com certificado ativo
- com numero WhatsApp ativo
3. Consulta DF-e por `distNSU` usando ultimo NSU salvo
4. Recebe XMLs novos, importa no banco
5. Atualiza `DfeSyncState` (`ultimoNsu`, `ultimoSyncAt`, `ultimoStatus`)
6. Se importou novas notas, envia mensagem proativa no WhatsApp

## 4. Como o sistema sabe que a nota e nova
1. Usa NSU incremental da SEFAZ (`ultNSU` / `maxNSU`)
2. Guarda progresso por empresa em `DfeSyncState.ultimoNsu`
3. No proximo ciclo, consulta a partir do ultimo NSU conhecido
4. Dedupe adicional por chave no banco:
- `NfeDocument` tem `@@unique([companyId, chave])`

## 5. Scheduler e cadencia
Arquivo: `apps/api/src/modules/jobs/scheduler.ts`

Cron atual:
```txt
*/30 * * * * *
```
Ou seja, checa a cada 30 segundos.

`runOnStart: true`:
quando scheduler sobe, executa uma rodada imediata.

Importante:
1. A execucao real por empresa respeita intervalo minimo no banco.
2. Regra atual: `SYNC_MIN_INTERVAL_SECONDS=3630` (1h + 30s) apos `ultimoSyncAt`.
3. Mesmo com checagem a cada 30s, a empresa so roda quando esse tempo minimo for atingido.

## 6. Cooldown automatico (cStat 656)
Se SEFAZ retornar consumo indevido (`cStat 656`):
1. Sistema grava `cooldown_until` em `ultimoStatus`
2. Ignora novas tentativas para a empresa ate o horario permitido
3. Exibe tempo restante no monitoramento

## 7. Webhooks (Evolution API)
Rotas aceitas:
1. `POST /webhooks/evolution/messages`
2. `POST /webhooks/evolution/messages/:event`
3. `POST /webhooks/evolution/session`
4. `POST /webhooks/evolution/session/:event`

Se a Evolution pedir apenas 1 URL:
- usar `https://SEU_DOMINIO/webhooks/evolution/messages/messages-upsert`

## 8. Regras de roteamento de mensagens
1. Ignora mensagens `fromMe`
2. Ignora numero do proprio agente (quando configurado)
3. So processa numero autorizado por empresa ativa
4. Classifica intencao (`ver`, `importar`, `ver_e_importar`, `ajuda`)
5. Se houver XML/anexo, tenta importar automaticamente

## 9. IA
Servico: `apps/api/src/services/ai.service.ts`

1. Resolve prompt:
- primeiro prompt da empresa
- depois prompt global
- fallback padrao
2. Classifica intencao com Groq
3. Se Groq falhar, aplica fallback heuristico
4. Gera resposta natural para WhatsApp

## 10. Evolution API
Servico: `apps/api/src/services/evolution.service.ts`

Capacidades:
1. iniciar sessao
2. ler status da sessao
3. obter QR code
4. enviar texto
5. baixar midia
6. extrair base64 de mensagem de midia

## 11. Seguranca
1. JWT access token + refresh token
2. Roles (`admin` e `company`)
3. Senhas com hash bcrypt
4. XML e certificado armazenados criptografados no banco
5. Refresh token persistido com hash e revogacao

## 12. Sessao web e expiracao
1. `ACCESS_TOKEN_EXPIRES_IN` default = `1h`
2. Frontend faz logout automatico quando token expira
3. Frontend tambem trata `401` globalmente com redirecionamento para login

## 13. Banco de dados (modelos-chave)
1. `User`
2. `Company`
3. `CompanyCertificate`
4. `CompanyWhatsappNumber`
5. `AiPrompt`
6. `WhatsappSession`
7. `NfeDocument`
8. `NfeItem`
9. `DfeSyncState`
10. `MessageLog`
11. `JobRun`
12. `RefreshToken`

## 14. Endpoints principais
### Auth
1. `POST /auth/login`
2. `POST /auth/refresh`
3. `POST /auth/logout`

### Admin
1. `POST /admin/companies`
2. `GET /admin/companies`
3. `PATCH /admin/companies/:id`
4. `POST /admin/companies/:id/whatsapp-numbers`
5. `PATCH /admin/companies/:id/whatsapp-numbers/:numId`
6. `DELETE /admin/companies/:id/whatsapp-numbers/:numId`
7. `PUT /admin/prompts/global`
8. `GET /admin/prompts/global`
9. `PUT /admin/companies/:id/prompt`
10. `GET /admin/companies/:id/prompt`
11. `GET /admin/monitoring/overview`
12. `GET /admin/whatsapp/session`
13. `POST /admin/whatsapp/session/start`
14. `GET /admin/whatsapp/session/qrcode`

### Company
1. `GET /company/me`
2. `POST /company/certificate-a1` (multipart)
3. `DELETE /company/certificate-a1`
4. `GET /company/dashboard/summary`
5. `GET /company/nfes`
6. `GET /company/nfes/:id`
7. `GET /company/monitoring/overview`

### Webhooks
1. `POST /webhooks/evolution/messages`
2. `POST /webhooks/evolution/messages/:event`
3. `POST /webhooks/evolution/session`
4. `POST /webhooks/evolution/session/:event`

## 15. Variaveis de ambiente criticas
### API
1. `DATABASE_URL`
2. `JWT_ACCESS_SECRET`
3. `JWT_REFRESH_SECRET`
4. `ACCESS_TOKEN_EXPIRES_IN`
5. `REFRESH_TOKEN_EXPIRES_IN_DAYS`
6. `APP_ENCRYPTION_KEY`
7. `EVOLUTION_BASE_URL`
8. `EVOLUTION_API_KEY`
9. `EVOLUTION_INSTANCE_NAME`
10. `SEFAZ_TP_AMB`
11. `SEFAZ_CUF_AUTOR`
12. `SEFAZ_NFE_DIST_PROD_URL`
13. `SEFAZ_NFE_DIST_HOMOLOG_URL`
14. `SEFAZ_TIMEOUT_MS`
15. `SEFAZ_MAX_BATCHES_PER_SYNC`
16. `SYNC_MIN_INTERVAL_SECONDS`
17. `AGENT_WHATSAPP_NUMBER`
18. `GROQ_API_KEY`
19. `GROQ_MODEL`
20. `ENABLE_EMBEDDED_WORKER`
21. `SERVE_WEB_STATIC`

### Web
1. `VITE_API_URL`

## 16. Comandos de operacao
### Desenvolvimento unificado
```bash
npm run dev
```

### API apenas
```bash
npm run dev:api
```

### Worker apenas
```bash
npm run dev:worker
```

### Web apenas
```bash
npm run dev:web
```

### Build geral
```bash
npm run build
```

### Producao single service (API + worker + web estatico)
```bash
npm run build:panel
npm run start:panel
```

## 17. Prisma em banco cloud
Em ambiente cloud sem permissao para criar shadow database:
1. Evitar `prisma migrate dev`
2. Usar:
```bash
npm run prisma:generate
npm run prisma:push
```

## 18. Troubleshooting tecnico
### 404 em webhook
Validar URL com sufixo correto de evento (`.../messages/messages-upsert`).

### 200 no webhook mas sem resposta
Verificar:
1. numero autorizado
2. sessao WhatsApp conectada
3. bloqueio por numero do proprio agente

### XML nao importa
1. validar se XML e NF-e valido
2. validar se o anexo chegou pela Evolution
3. verificar logs de `resolveXmlFromIncoming`

### Sync nao roda sozinho
1. garantir worker ativo (`ENABLE_EMBEDDED_WORKER=true` ou processo worker separado)
2. lembrar que a empresa so executa apos `SYNC_MIN_INTERVAL_SECONDS` desde o ultimo sync

## 19. Escalabilidade de mensagens (novo)
### Objetivo
Suportar multiplas empresas simultaneamente com controle de throughput no WhatsApp para reduzir risco de ban.

### Componentes
1. `MessageDispatch`: fila persistida no MySQL para cada mensagem de saida.
2. `WebhookEvent`: idempotencia de eventos recebidos da Evolution.
3. `RateLimitPolicy`: politicas de limite por escopo (global, instancia, empresa, contato).
4. `CompanyOperationalLimit`: limites operacionais por empresa (incluindo cap diario).
5. Worker outbound (`bullmq` + Redis) para envio assicrono e retentativa.

### Fluxo outbound
1. API gera `MessageLog` com status `received`.
2. API cria `MessageDispatch` com status `queued`.
3. Worker consome o dispatch.
4. Worker aplica rate limit + jitter.
5. Se permitido, envia para Evolution.
6. Atualiza status:
- sucesso: `MessageDispatch=sent` e `MessageLog=processed`
- falha temporaria: `MessageDispatch=retry` com `nextAttemptAt`
- falha final: `MessageDispatch=dead` e `MessageLog=failed`

### Idempotencia webhook
1. Tenta dedupe por `eventId` (provider + eventId, unico).
2. Se nao houver `eventId`, dedupe por hash do payload em janela curta.
3. Duplicados retornam `200` com `ignored=duplicate_event`.

### Novos endpoints admin
1. `GET /admin/monitoring/queues`
2. `GET /admin/monitoring/dispatches`
3. `GET /admin/limits/policies`
4. `PUT /admin/limits/policies`

### Novos endpoints empresa
1. `GET /company/monitoring/messages`
2. `GET /company/monitoring/rate-limit`

### Novas variaveis de ambiente
1. `REDIS_URL`
2. `QUEUE_OUTBOUND_ENABLED`
3. `RATE_LIMIT_ENABLED`
4. `WEBHOOK_FAST_ACK_ENABLED` (reservado para fase de fast-ack com inbound queue)
5. `ENABLE_MESSAGE_WORKER`

### Defaults de seguranca (quando politicas nao estao cadastradas)
1. Instancia: 20 msg/min
2. Empresa: 12 msg/min
3. Contato: 3 msg/min
4. Atraso aleatorio: 1500ms a 4500ms
5. Cap diario por empresa: 500 envios
