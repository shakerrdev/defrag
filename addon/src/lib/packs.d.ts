declare module "defrag:packs" {
  type CompactPack = Omit<import("@defrag/scenario").Pack, "scenarios"> & {
    scenarios: import("@defrag/scenario").CompactScenario[];
  };
  const packs: CompactPack[];
  export default packs;
}
