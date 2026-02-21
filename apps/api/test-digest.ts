import { runDailyImportSummaryJob } from "./src/modules/jobs/hourly-sync.js";

async function test() {
    console.log("Starting runDailyImportSummaryJob...");
    await runDailyImportSummaryJob();
    console.log("Finished runDailyImportSummaryJob");
    process.exit(0);
}

test().catch(console.error);
