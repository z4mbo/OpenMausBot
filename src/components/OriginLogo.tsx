import { MausAvatar } from "./Avatar";

const WHITE_BODY: [string, string, string] = ["#ffffff", "#f1f1f1", "#d9d9d9"];

/** The Origin mark: a black tile holding a live agent face that blinks and looks around. */
export function OriginLogo({ size = 44, label = "Origin" }: { size?: number; label?: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex shrink-0 items-center justify-center bg-[#111111] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
      style={{ width: size, height: size, borderRadius: size * 0.25 }}>
      <MausAvatar color="blue" gradient={WHITE_BODY} eyeColor="#050505" bodyId="circle" size={Math.round(size * 0.8)}
        lookAround={0.8} trackPointer showMouth={false} />
    </span>
  );
}
