import { Console, Instance } from "cs_script/point_script";

const CHAT_INTERVAL = 0.8;
const MAX_QUEUED = 6;
const MAX_RECENT = 6;

const queue: string[] = [];
const recent: { text: string; at: number }[] = [];
let nextChatAt = 0;

export function tell(message: string) {
  Console.Log(`[defrag] ${message}`);
  recent.push({ text: message, at: Instance.GetGameTime() });
  if (recent.length > MAX_RECENT) recent.shift();
  queue.push(message.replace(/[;"]/g, " "));
  if (queue.length > MAX_QUEUED) queue.shift();
}

export function flushChat(now: number) {
  if (!queue.length || now < nextChatAt) return;
  Console.ServerCommand(`say [defrag] ${queue.shift()}`);
  nextChatAt = now + CHAT_INTERVAL;
}

export function recentMessages(now: number, seconds: number) {
  return recent.filter((m) => now - m.at <= seconds).map((m) => m.text);
}

export type Command = { name: string; args: string[] };

export function parseCommand(text: string): Command | undefined {
  const trimmed = text.trim();
  if (!/^[!.]/.test(trimmed)) return undefined;
  const [name = "", ...args] = trimmed.slice(1).split(/\s+/);
  return { name: name.toLowerCase(), args };
}
