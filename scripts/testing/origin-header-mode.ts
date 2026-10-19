export * from "../../src/lib/interface-mode";

export function useAdvancedMode(): boolean {
  return new URLSearchParams(location.search).get("mode") !== "simple";
}
