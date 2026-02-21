import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { verifyPassword } from "../../lib/password.js";
import { issueTokens, revokeRefreshToken, verifyRefreshToken } from "./token.js";
import { sha256 } from "../../lib/hash.js";

const loginSchema = z.object({
  email: z.string().trim().min(3),
  password: z.string().min(8),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Payload invalido", errors: parsed.error.flatten().fieldErrors });
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!user || !user.active) {
      return reply.code(401).send({ message: "Credenciais invalidas" });
    }

    if ((user.role === "company" || user.role === "barber") && (!user.company || !user.company.active)) {
      return reply.code(403).send({ message: "Empresa inativa" });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ message: "Credenciais invalidas" });
    }

    const tokens = await issueTokens(app, {
      userId: user.id,
      role: user.role,
      companyId: user.companyId,
      email: user.email,
      serviceType: user.company?.aiType ?? null,
    });

    return reply.send({
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
        companyId: user.companyId,
        serviceType: user.company?.aiType ?? null,
        bookingSector: user.company?.bookingSector ?? undefined,
      },
      ...tokens,
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Payload invalido" });
    }

    try {
      const decoded = verifyRefreshToken(parsed.data.refreshToken);
      const tokenHash = sha256(parsed.data.refreshToken);

      const stored = await prisma.refreshToken.findFirst({
        where: {
          tokenHash,
          jti: decoded.jti,
          revokedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        include: {
          user: {
            include: {
              company: {
                select: {
                  aiType: true,
                  bookingSector: true,
                },
              },
            },
          },
        },
      });

      if (!stored || !stored.user.active) {
        return reply.code(401).send({ message: "Refresh token invalido" });
      }

      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });

      const tokens = await issueTokens(app, {
        userId: stored.user.id,
        role: stored.user.role,
        companyId: stored.user.companyId,
        email: stored.user.email,
        serviceType: stored.user.company?.aiType ?? null,
      });

      return reply.send(tokens);
    } catch {
      return reply.code(401).send({ message: "Refresh token invalido" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Payload invalido" });
    }

    await revokeRefreshToken(parsed.data.refreshToken);
    return reply.code(204).send();
  });
}
