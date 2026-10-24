import { createLucideIcon } from "lucide-react";

export const ChatIcon = createLucideIcon("origin-chat", [
  ["path", { d: "M7.5 17H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-5.5l-4 3.25z", key: "bubble" }],
]);

export const CallIcon = createLucideIcon("origin-call", [
  ["rect", { x: "3", y: "6", width: "12.5", height: "12", rx: "3", key: "lens" }],
  ["path", { d: "m15.5 10.25 4.1-2.46a.6.6 0 0 1 .9.51v7.4a.6.6 0 0 1-.9.51l-4.1-2.46", key: "cone" }],
]);
