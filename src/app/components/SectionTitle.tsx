export function SectionTitle({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2
        className="text-lg uppercase tracking-widest font-semibold"
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          color: "var(--foreground)",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </h2>
      {sub && <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{sub}</p>}
    </div>
  );
}
