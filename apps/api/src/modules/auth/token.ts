import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { CompanyAiType, UserRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { sha256 } from "../../lib/hash.js";
import { prisma } from "../../lib/prisma.js";

interface TokenInput {
  userId: string;
  role: UserRole;
  companyId: string | null;
  email: string;
  serviceType: CompanyAiType | null;
}

export async function issueTokens(fastify: FastifyInstance, input: TokenInput) {
  const accessToken = fastify.jwt.sign(
    {
      role: input.role,
      companyId: input.companyId,
      email: input.email,
      serviceType: input.serviceType,
    },
    {
      sub: input.userId,
      expiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
    },
  );

  const jti = randomUUID();
  const refreshToken = jwt.sign(
    {
      role: input.role,
      companyId: input.companyId,
      email: input.email,
      serviceType: input.serviceType,
      jti,
    },
    env.JWT_REFRESH_SECRET,
    {
      subject: input.userId,
      expiresIn: `${env.REFRESH_TOKEN_EXPIRES_IN_DAYS}d`,
    },
  );

  await prisma.refreshToken.create({
    data: {
      userId: input.userId,
      tokenHash: sha256(refreshToken),
      jti,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return {
    accessToken,
    refreshToken,
    refreshExpiresInDays: env.REFRESH_TOKEN_EXPIRES_IN_DAYS,
  };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = sha256(token);

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export function verifyRefreshToken(token: string): {
  sub: string;
  role: UserRole;
  companyId: string | null;
  email: string;
  serviceType: CompanyAiType | null;
  jti: string;
} {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;

  if (!decoded.sub || !decoded.jti || !decoded.role || !decoded.email) {
    throw new Error("Refresh token invalido");
  }

  return {
    sub: decoded.sub,
    role: decoded.role as UserRole,
    companyId: (decoded.companyId as string | null) ?? null,
    email: decoded.email as string,
    serviceType: (decoded.serviceType as CompanyAiType | null) ?? null,
    jti: decoded.jti as string,
  };
}
