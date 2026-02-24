import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import jwt from "@fastify/jwt";
import { env } from "./config/env.js";
import { authRoutes } from "./modules/auth/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { companyRoutes } from "./modules/company/routes.js";
import { barberRoutes } from "./modules/barber/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { webhooksRoutes } from "./modules/webhooks/routes.js";
import { prisma } from "./lib/prisma.js";
import { disconnectRedisClients } from "./lib/redis.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    disableRequestLogging: !env.LOG_REQUESTS,
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

  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  await authRoutes(app);
  await adminRoutes(app);
  await companyRoutes(app);
  await barberRoutes(app);
  await billingRoutes(app);
  await webhooksRoutes(app);

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

    reply.code(500).send({
      message: "Erro interno",
      error: env.NODE_ENV === "production" ? undefined : error instanceof Error ? error.message : "Erro desconhecido",
    });
  });

  app.addHook("onClose", async () => {
    await disconnectRedisClients();
    await prisma.$disconnect();
  });

  return app;
}
