import type { ContextOptions, SamplingParams } from "@lloyal-labs/sdk";

export const SAMPLING: SamplingParams = {
  temperature: 1,
  topP: 0.95,
  topK: 20,
  minP: 0,
  penalties: { repeat: 1, frequency: 0, presence: 1.5, lastN: -1 },
};
export function benchmarkOptions(
  modelPath: string,
  nBatch = 512,
): ContextOptions {
  if (![512, 1024, 2048].includes(nBatch))
    throw new Error("Unsupported preflight batch size");
  return {
    modelPath,
    nCtx: 262144,
    nSeqMax: 16,
    nBatch,
    typeK: "f16",
    typeV: "f16",
  };
}
export function verifyModelReceipt(receipt: any, sha256: string): void {
  if (receipt?.model?.sha256 !== sha256)
    throw new Error("Model hash differs from conversion receipt");
  const types = receipt.model.tensorTypes;
  if (
    !types?.BF16 ||
    Object.keys(types).some((t) => !["BF16", "F32"].includes(t))
  )
    throw new Error(
      "Model precision differs from BF16 with F32 auxiliary tensors",
    );
  const metadata = receipt.model.metadata;
  if (
    metadata?.["general.architecture"] !== "qwen35" ||
    metadata?.["qwen35.context_length"] !== 262144
  )
    throw new Error("Unexpected model architecture or native context");
}
