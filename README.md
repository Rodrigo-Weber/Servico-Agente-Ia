# WeberServicos | Plataforma de NF-e com WhatsApp e IA

Sistema web multiempresa para operacao fiscal automatizada:
- importacao de NF-e por XML e por consulta DF-e (SEFAZ)
- atendimento no WhatsApp com IA
- painel administrativo e painel da empresa

## Visao geral
O WeberServicos foi pensado para ser simples de usar e profissional para vender.
Com ele, o admin centraliza a operacao e cada empresa cliente acessa seu proprio ambiente, com certificado A1, monitoramento e historico de notas.

## O que o sistema entrega
1. Cadastro e gestao de empresas (admin)
2. Controle de numeros autorizados por empresa (WhatsApp)
3. Conexao da sessao principal do WhatsApp via Evolution API (QR Code)
4. IA com prompt global e prompt por empresa
5. Importacao de XML enviado no WhatsApp
6. Sync horario de DF-e via SEFAZ (consulta por NSU)
7. Painel empresa enxuto: certificado + NF-e importadas + consulta de notas
8. Monitoramento operacional para admin
9. Fila outbound WhatsApp com controle de taxa (opcional por flag)
10. Memoria conversacional persistida por empresa + numero

## Fluxo principal
1. Admin cria empresa
2. Empresa faz login e envia certificado A1 (.pfx)
3. Admin cadastra numeros WhatsApp autorizados para essa empresa
4. Evolution envia eventos para os webhooks da API
5. Worker consulta SEFAZ de hora em hora e detecta novas notas
6. Sistema importa/atualiza notas e notifica usuario no WhatsApp

Observacao de cadencia:
- O scheduler checa continuamente.
- Cada empresa so pode sincronizar novamente apos `1h + 30s` da ultima execucao (configuravel por `SYNC_MIN_INTERVAL_SECONDS`).

## Perfis de acesso
- `admin`: controla empresas, prompts, WhatsApp e monitoramento global
- `company`: ve suas notas, gerencia certificado e acompanha monitoramento da propria empresa

## Execucao rapida (local)
1. Instalar dependencias:
```bash
npm install
```
2. Configurar variaveis:
- `apps/api/.env`
- `apps/web/.env`
3. Subir schema no banco:
```bash
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
```
4. Rodar tudo em um comando:
```bash
npm run dev
```

### Escala de mensagens (Redis + BullMQ)
Para ativar fila de envio e limitacao anti-ban do WhatsApp, configure no `apps/api/.env`:
```env
REDIS_URL=redis://127.0.0.1:6379
QUEUE_OUTBOUND_ENABLED=true
RATE_LIMIT_ENABLED=true
ENABLE_MESSAGE_WORKER=true
```
Sem essas flags, o sistema continua funcional em modo simples (envio direto).

## Execucao em producao (single service)
Para subir em EasyPanel com API + worker + frontend estatico:
1. Build:
```bash
npm run build:panel
```
2. Start:
```bash
npm run start:panel
```

## Credenciais iniciais
- Email: `admin@local`
- Senha: `admin123`

## Documentacao completa
- Guia humano (operacao): `docs/DOCUMENTACAO_HUMANA.md`
- Documentacao tecnica: `docs/DOCUMENTACAO_TECNICA.md`

## Estrutura do projeto
- `apps/api`: Fastify + Prisma + Webhooks + Worker
- `apps/web`: React + TypeScript + Vite
- `packages/shared`: pacote compartilhado
