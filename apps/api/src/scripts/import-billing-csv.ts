import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { importBillingCsvForCompany } from "../modules/billing/csv-import.service.js";

async function main() {
  const companyId = process.env.BILLING_IMPORT_COMPANY_ID?.trim();

  const companies = companyId
    ? await prisma.company.findMany({
        where: {
          id: companyId,
          aiType: "billing",
        },
        select: {
          id: true,
          name: true,
        },
      })
    : await prisma.company.findMany({
        where: {
          aiType: "billing",
          active: true,
        },
        select: {
          id: true,
          name: true,
        },
      });

  if (companies.length === 0) {
    throw new Error("Nenhuma empresa billing encontrada para importacao");
  }

  for (const company of companies) {
    const result = await importBillingCsvForCompany(prisma, company.id);

    console.log(
      `[billing-import] ${company.name} (${company.id}) | fornecedores: +${result.suppliersCreated} / ~${result.suppliersUpdated} | documentos: +${result.documentsCreated} / ~${result.documentsUpdated} | total docs: ${result.documentsTotal}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("[billing-import] Falha:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
