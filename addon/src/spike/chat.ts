import { Console } from "cs_script/point_script";

export function tell(message: string) {
  Console.Log(`[defrag] ${message}`);
  Console.ServerCommand(`say [defrag] ${message.replace(/[;"]/g, " ")}`);
}

export type Command = { name: string; args: string[] };

export function parseCommand(text: string): Command | undefined {
  const trimmed = text.trim();
  if (!/^[!.]/.test(trimmed)) return undefined;
  const [name = "", ...args] = trimmed.slice(1).split(/\s+/);
  return { name: name.toLowerCase(), args };
}
