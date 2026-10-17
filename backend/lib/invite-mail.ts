import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { originUrl } from "./integration-bridge";
import { integrationDb } from "./githubConnection";

export async function sendInviteMail(invite: { token: string; teamName: string }, email: string, actorName: string, requestId?: string) {
  const inviteLink = `${originUrl()}/join/${invite.token}`;
  if (!process.env.ORIGIN_SMTP_HOST) return { inviteLink, sent: false };
  const deliveryId = requestId ? createHash("sha256").update(`${requestId}:${email}:${invite.token}`).digest("hex") : null;
  if (deliveryId) {
    const db = integrationDb();
    db.exec("CREATE TABLE IF NOT EXISTS agent_invite_deliveries(id TEXT PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0)");
    // Claim before SMTP: an ambiguous network failure must not send a duplicate invite.
    if (!db.prepare("INSERT OR IGNORE INTO agent_invite_deliveries(id) VALUES(?)").run(deliveryId).changes) {
      const row = db.prepare("SELECT sent FROM agent_invite_deliveries WHERE id=?").get(deliveryId) as { sent: number };
      return { inviteLink, sent: row.sent === 1 };
    }
  }
  try {
    const transport = nodemailer.createTransport({ host: process.env.ORIGIN_SMTP_HOST, port: Number(process.env.ORIGIN_SMTP_PORT || "465"), secure: process.env.ORIGIN_SMTP_SECURE !== "false", auth: { user: process.env.ORIGIN_SMTP_USER, pass: process.env.ORIGIN_SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000 });
    await transport.sendMail({ from: process.env.ORIGIN_SMTP_FROM || process.env.ORIGIN_SMTP_USER, to: email, subject: `Join ${invite.teamName} on Origin`, text: `${actorName} invited you to ${invite.teamName}.\n\nJoin the workspace: ${inviteLink}\n\nThis invitation expires in 7 days.`, ...(requestId ? { messageId: `<${createHash("sha256").update(requestId).digest("hex")}@${new URL(originUrl()).hostname}>` } : {}) });
    if (deliveryId) integrationDb().prepare("UPDATE agent_invite_deliveries SET sent=1 WHERE id=?").run(deliveryId);
    return { inviteLink, sent: true };
  } catch { return { inviteLink, sent: false }; }
}
