import { UserRole } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      role: UserRole;
      companyId: string | null;
      email: string;
    };
  }
}
