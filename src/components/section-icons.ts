import { createLucideIcon } from "lucide-react";

export const ChatIcon = createLucideIcon("origin-chat", [
  ["path", { d: "M7.5 17H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-5.5l-4 3.25z", key: "bubble" }],
]);

export const CallIcon = createLucideIcon("origin-call", [
  ["rect", { x: "3", y: "6", width: "12.5", height: "12", rx: "3", key: "lens" }],
  ["path", { d: "m15.5 10.25 4.1-2.46a.6.6 0 0 1 .9.51v7.4a.6.6 0 0 1-.9.51l-4.1-2.46", key: "cone" }],
]);

export const StudioIcon = createLucideIcon("origin-studio", [
  ["path", { d: "M10.5 4c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6z", key: "spark" }],
  ["path", { d: "M18 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5z", key: "glint" }],
]);

export const PublishIcon = createLucideIcon("origin-publish", [
  ["path", { d: "M12 14.5V4", key: "shaft" }],
  ["path", { d: "m7.75 8.25 4.25-4.25 4.25 4.25", key: "head" }],
  ["path", { d: "M4.5 13.5v3.5a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-3.5", key: "tray" }],
]);
