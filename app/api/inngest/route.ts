import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { ingestDocument } from "@/inngest/functions/ingest-document";
import { digestMonthly } from "@/inngest/functions/digest-monthly";
import { syncSalesforce } from "@/inngest/functions/sync-salesforce";
import { syncKognitosV2 } from "@/inngest/functions/sync-kognitos-v2";
import { syncCalendar } from "@/inngest/functions/sync-calendar";
import { syncMonday } from "@/inngest/functions/sync-monday";
import { runTask } from "@/inngest/functions/run-task";
import { syncAllWeekly } from "@/inngest/functions/sync-all-weekly";
import { processInboundEmail } from "@/inngest/functions/process-inbound-email";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ingestDocument,
    digestMonthly,
    syncSalesforce,
    syncKognitosV2,
    syncCalendar,
    syncMonday,
    runTask,
    syncAllWeekly,
    processInboundEmail,
  ],
});
