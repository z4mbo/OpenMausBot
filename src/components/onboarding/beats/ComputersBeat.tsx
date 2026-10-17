import { useEffect } from "react";
import { ApiKeyRow, VpsConnection } from "@/components/ApiKeys";
import { t } from "@/lib/i18n";
import { PrimaryButton, QuietButton, staggerIndex, type BeatProps } from "./shared";

export function ComputersBeat({ onNext, onSkip, setMascot }: BeatProps) {
  useEffect(() => {
    setMascot("working");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col">
      <p className="animate-rise mt-1 text-[13.5px] text-ink-secondary">{t("onboarding.computers.intro")}</p>
      <div className="animate-rise mt-4 flex flex-col gap-4 rounded-xl bg-card p-3.5" style={staggerIndex(1)}>
        <ApiKeyRow section="box" />
        <VpsConnection />
      </div>
      <PrimaryButton onClick={onNext} className="mt-5">
        {t("onboarding.continue")}
      </PrimaryButton>
      <QuietButton onClick={onSkip} className="mt-3 self-center">
        {t("onboarding.skip")}
      </QuietButton>
    </div>
  );
}
