export function SectionTitle({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2
        className="text-xs uppercase tracking-widest font-semibold"
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          color: "#dce3ec",
          letterSpacing: "0.12em",
        }}
      >
        {label}
      </h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
