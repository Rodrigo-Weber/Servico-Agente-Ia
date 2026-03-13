import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import jwt from "@fastify/jwt";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { authRoutes } from "./modules/auth/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { companyRoutes } from "./modules/company/routes.js";
import { barberRoutes } from "./modules/barber/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { webhooksRoutes } from "./modules/webhooks/routes.js";
import { nfseRoutes } from "./modules/nfse/routes.js";
import { prisma } from "./lib/prisma.js";
import { disconnectRedisClients } from "./lib/redis.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    disableRequestLogging: !env.LOG_REQUESTS,
    trustProxy: env.NODE_ENV === "production",
  });

  // ── Security Headers ──
  await app.register(helmet, {
    contentSecurityPolicy: false, // CSP desabilitado para não bloquear o frontend SPA
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  });

  // ── Global Rate Limit ──
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    allowList: ["127.0.0.1", "::1"],
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  });

  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
  });

  app.get("/health", async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", ts: new Date().toISOString() };
    } catch {
      return { status: "degraded", ts: new Date().toISOString(), db: "unreachable" };
    }
  });

  await authRoutes(app);
  await adminRoutes(app);
  await companyRoutes(app);
  await barberRoutes(app);
  await billingRoutes(app);
  await webhooksRoutes(app);
  await app.register(nfseRoutes, { prefix: "/nfse" });

  if (env.SERVE_WEB_STATIC) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const webDistPath = path.resolve(currentDir, "../../web/dist");

    if (fs.existsSync(webDistPath)) {
      await app.register(fastifyStatic, {
        root: webDistPath,
        prefix: "/",
      });

      app.setNotFoundHandler((request, reply) => {
        if (request.method !== "GET") {
          return reply.code(404).send({ message: "Rota nao encontrada" });
        }

        const accept = typeof request.headers.accept === "string" ? request.headers.accept : "";
        if (accept.includes("text/html")) {
          return reply.type("text/html").sendFile("index.html");
        }

        return reply.code(404).send({ message: "Rota nao encontrada" });
      });

      app.log.info({ webDistPath }, "Frontend estatico habilitado na API");
    } else {
      app.log.warn({ webDistPath }, "SERVE_WEB_STATIC ativo, mas build do frontend nao foi encontrado");
    }
  }

  app.setErrorHandler((error: unknown, _request, reply) => {
    app.log.error(error);

    if (reply.sent) {
      return;
    }

    // Rate limit errors
    if (error && typeof error === "object" && "statusCode" in error && (error as { statusCode: number }).statusCode === 429) {
      return reply.code(429).send({
        message: "Muitas requisicoes, tente novamente em instantes.",
      });
    }

    reply.code(500).send({
      message: "Erro interno",
      ...(env.NODE_ENV !== "production" && error instanceof Error
        ? { error: error.message }
        : {}),
    });
  });

  app.addHook("onClose", async () => {
    await disconnectRedisClients();
    await prisma.$disconnect();
  });

  return app;
}
