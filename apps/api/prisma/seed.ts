import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_GLOBAL_AI_PROMPT } from "../src/config/default-ai-prompt.js";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@local";
  const exists = await prisma.user.findUnique({ where: { email } });

  if (!exists) {
    await prisma.user.create({
      data: {
        role: "admin",
        email,
        passwordHash: await bcrypt.hash("admin123", 12),
        active: true,
      },
    });
  }

  const hasGlobalPrompt = await prisma.aiPrompt.findFirst({
    where: { scope: "global", active: true },
  });

  if (!hasGlobalPrompt) {
    await prisma.aiPrompt.create({
      data: {
        scope: "global",
        promptText: DEFAULT_GLOBAL_AI_PROMPT,
        version: 1,
        active: true,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
