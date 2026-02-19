import { FastifyReply, FastifyRequest } from "fastify";
import { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as { sub: string; role: UserRole; companyId?: string | null; email: string };

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      reply.code(401).send({ message: "Usuario invalido" });
      return;
    }

    request.authUser = {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      email: user.email,
    };
  } catch {
    reply.code(401).send({ message: "Nao autenticado" });
  }
}

export function requireRole(role: UserRole) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authUser) {
      reply.code(401).send({ message: "Nao autenticado" });
      return;
    }

    if (request.authUser.role !== role) {
      reply.code(403).send({ message: "Acesso negado" });
      return;
    }
  };
}

export function requireRoles(roles: UserRole[]) {
  return async function rolesGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authUser) {
      reply.code(401).send({ message: "Nao autenticado" });
      return;
    }

    if (!roles.includes(request.authUser.role)) {
      reply.code(403).send({ message: "Acesso negado" });
      return;
    }
  };
}
