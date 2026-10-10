/** This review belongs to the prototype workload, not to either inference backend. */
export const workloadReview = {
  id: '2026-10-08-prototype-workload-mismatch',
  status: 'invalid-comparison',
  comparisonEligible: false,
  audit: 'WORKLOAD-AUDIT.md',
  reason: 'The LangGraph path omitted preflight, simplified retrieval, used prepared PDF evidence, and requested shorter free-text reports instead of the Fieldnote citedReport contract.',
  allowedUse: 'Functional, transport, GPU startup and cache-counter diagnostics only. Timings cannot establish an architectural advantage.',
  browserScope: 'The browser measurements describe the shared diagnostic viewer, not the existing Fieldnote frontend.',
} as const;

export function requireMatchedWorkload(): void {
  throw new Error(`Comparison runs are disabled: ${workloadReview.reason} See ${workloadReview.audit}.`);
}
