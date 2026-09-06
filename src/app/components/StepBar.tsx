import { Check } from "lucide-react";
import { Num } from "./Typography";

export function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-sm flex items-center justify-center text-xs font-medium flex-shrink-0"
                style={{
                  backgroundColor: done ? "var(--sukses-kuat)" : active ? "var(--primary)" : "transparent",
                  color: done || active ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  border: done || active ? "none" : "1px solid rgb(var(--kabut-rgb) / 0.2)",
                }}
              >
                {done ? <Check size={10} /> : <Num>{n}</Num>}
              </div>
              <span className="text-xs" style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="w-10 h-px mx-3"
                style={{ backgroundColor: done ? "var(--sukses-kuat)" : "rgb(var(--kabut-rgb) / 0.18)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
