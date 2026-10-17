export type Planned = { questionId: string; repeat: number };
export type Graded = Planned & {
  verdict: "CORRECT" | "INCORRECT";
  status: "completed" | "failed";
};
export function aggregate(planned: Planned[], graded: Graded[]) {
  const key = (p: Planned) => `${p.questionId}:${p.repeat}`;
  const expected = new Set(planned.map(key));
  if (expected.size !== planned.length || !expected.size)
    throw new Error("Invalid planned attempts");
  const seen = new Set<string>();
  for (const g of graded) {
    if (!expected.has(key(g))) throw new Error("Unplanned grade");
    if (seen.has(key(g))) throw new Error("Duplicate grade");
    seen.add(key(g));
  }
  if (seen.size !== expected.size)
    throw new Error(`Missing ${expected.size - seen.size} grades`);
  const correct = graded.filter((g) => g.verdict === "CORRECT").length;
  const repeats = [...new Set(planned.map((p) => p.repeat))]
    .sort((a, b) => a - b)
    .map((repeat) => {
      const rows = graded.filter((g) => g.repeat === repeat),
        n = rows.filter((g) => g.verdict === "CORRECT").length;
      return {
        repeat,
        correct: n,
        total: rows.length,
        percent: (100 * n) / rows.length,
      };
    });
  return {
    correct,
    total: planned.length,
    percent: (100 * correct) / planned.length,
    solverFailures: graded.filter((g) => g.status === "failed").length,
    repeats,
  };
}
