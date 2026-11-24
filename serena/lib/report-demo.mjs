export const simulatedReportStore = {
  async all(collection) {
    if (collection !== "appointments") return [];
    return ["pre", "post"].flatMap((phase) => {
      const before = phase === "pre";
      return Array.from({ length: 40 }, (_, i) => ({
        id: `demo-${phase}-${i}`,
        demo: true,
        phase,
        date: `2026-11-${String((before ? 2 : 9) + Math.floor(i / 6)).padStart(2, "0")}`,
        status: i < (before ? 10 : 6) ? "No asistió" : "Asistió",
        error: i < (before ? 8 : 2),
        duplicate: before && i < 4,
        followup: i < (before ? 24 : 38),
        source: !before && i < 28 ? "portal" : "staff",
      }));
    });
  },
};
