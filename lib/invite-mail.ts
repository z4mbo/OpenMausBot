import nodemailer from "nodemailer";
import { originUrl } from "./integration-bridge";

export async function sendInviteMail(invite: { token: string; teamName: string }, email: string, actorName: string) {
  const inviteLink = `${originUrl()}/join/${invite.token}`;
  if (!process.env.ORIGIN_SMTP_HOST) return { inviteLink, sent: false };
  try {
    const transport = nodemailer.createTransport({ host: process.env.ORIGIN_SMTP_HOST, port: Number(process.env.ORIGIN_SMTP_PORT || "465"), secure: process.env.ORIGIN_SMTP_SECURE !== "false", auth: { user: process.env.ORIGIN_SMTP_USER, pass: process.env.ORIGIN_SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000 });
    await transport.sendMail({ from: process.env.ORIGIN_SMTP_FROM || process.env.ORIGIN_SMTP_USER, to: email, subject: `Join ${invite.teamName} on Origin`, text: `${actorName} invited you to ${invite.teamName}.\n\nJoin the workspace: ${inviteLink}\n\nThis invitation expires in 7 days.` });
    return { inviteLink, sent: true };
  } catch { return { inviteLink, sent: false }; }
}
