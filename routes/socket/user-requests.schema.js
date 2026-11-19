const { z } = require("zod");

const replayUidSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

module.exports = { replayUidSchema };
