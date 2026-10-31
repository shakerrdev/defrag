import { Console, Instance } from "cs_script/point_script";

function readAll(): Record<string, unknown> {
  try {
    const data = JSON.parse(Instance.GetSaveData() || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    Console.Log("[defrag] ignoring unreadable save data");
    return {};
  }
}

export function loadSection<T>(key: string): T | undefined {
  return readAll()[key] as T | undefined;
}

export function saveSection(key: string, value: unknown) {
  const all = readAll();
  all[key] = value;
  Instance.SetSaveData(JSON.stringify(all));
}

export function patchSave(values: Record<string, unknown>) {
  Instance.SetSaveData(JSON.stringify({ ...readAll(), ...values }));
}
