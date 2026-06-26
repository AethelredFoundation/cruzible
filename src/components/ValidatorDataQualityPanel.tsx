import type {
  ValidatorDataQualitySignal,
  ValidatorDataQualityTone,
} from "@/lib/validators";

function qualityToneClasses(tone: ValidatorDataQualityTone): string {
  switch (tone) {
    case "healthy":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
    case "warning":
      return "border-amber-500/20 bg-amber-500/10 text-amber-100";
    case "critical":
      return "border-red-500/25 bg-red-500/10 text-red-100";
    case "unknown":
      return "border-slate-700 bg-slate-900/80 text-slate-300";
  }
}

function qualityDotClass(tone: ValidatorDataQualityTone): string {
  switch (tone) {
    case "healthy":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-400";
    case "critical":
      return "bg-red-400";
    case "unknown":
      return "bg-slate-500";
  }
}

export function ValidatorDataQualityPanel({
  signals,
}: {
  signals: ValidatorDataQualitySignal[];
}) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {signals.map((signal) => (
        <div
          key={signal.id}
          className={`rounded-2xl border px-4 py-3 ${qualityToneClasses(
            signal.tone,
          )}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] opacity-70">
                {signal.title}
              </p>
              <p className="mt-1 text-sm font-semibold">{signal.status}</p>
            </div>
            <span
              aria-hidden="true"
              className={`mt-1 h-2.5 w-2.5 rounded-full ${qualityDotClass(
                signal.tone,
              )}`}
            />
          </div>
          <p className="mt-3 text-xs leading-6 opacity-80">{signal.detail}</p>
        </div>
      ))}
    </div>
  );
}
