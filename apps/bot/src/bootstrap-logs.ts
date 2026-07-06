import { bindPrismaLogging, prisma } from "@grimkeeper/database";

import { installProcessErrorHandlers } from "./error-reporter.js";
import { installLogCapture, log } from "./logger.js";

installLogCapture();
installProcessErrorHandlers();
bindPrismaLogging(prisma, (level, msg, fields) => {
  log(level, msg, fields);
});
