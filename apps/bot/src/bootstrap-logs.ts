import { bindPrismaLogging, prisma } from "@grimkeeper/database";

import { installLogCapture, log } from "./logger.js";

installLogCapture();
bindPrismaLogging(prisma, (level, msg, fields) => {
  log(level, msg, fields);
});
