import type { Bot } from "@/state/store";
import { CloudGate, type OriginPageProps } from "../origin-pages/ui";

export function PipelinePage({ agent: _agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Pipeline">{() => null}</CloudGate>;
}
