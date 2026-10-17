import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) throw new Error("Provide a private output env file path");
try {
  writeFileSync(target, `ORIGIN_TURN_SECRET=${randomBytes(48).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  console.log("Created private TURN configuration");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Kept existing TURN configuration");
}
