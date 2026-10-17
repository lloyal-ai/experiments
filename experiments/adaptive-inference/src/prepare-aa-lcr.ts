import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DATASET, loadProblem, parseQuestions } from "./aa-lcr.js";
import { digest, writeJson } from "./artifacts.js";

const source = resolve(process.argv[2] ?? "work/datasets/aa-lcr");
const destination = resolve(process.argv[3] ?? "work/prepared/aa-lcr-v1.1");
const csv = readFileSync(`${source}/AA-LCR_Dataset.csv`);
const questions = parseQuestions(csv.toString("utf8"));
mkdirSync(resolve(destination, ".."), { recursive: true });
mkdirSync(destination);
const cases = questions.map((question) => {
  const problem = loadProblem(question, `${source}/documents/lcr`);
  writeJson(`${destination}/${question.id}.json`, problem, true);
  return {
    id: question.id,
    category: question.category,
    setId: question.setId,
    publishedInputTokens: question.publishedInputTokens,
    documentCount: problem.documents.length,
    promptSha256: problem.promptSha256,
    documents: problem.documents.map(({ filename, sha256 }) => ({
      filename,
      sha256,
    })),
  };
});
writeJson(
  `${destination}/manifest.json`,
  {
    dataset: DATASET,
    csvSha256: digest(csv),
    archiveSha256: digest(
      readFileSync(`${source}/extracted_text/AA-LCR_extracted-text.zip`),
    ),
    preparedAt: new Date().toISOString(),
    cases,
  },
  true,
);
console.log(
  JSON.stringify({
    destination,
    cases: cases.length,
    documentSets: new Set(cases.map((c) => c.setId)).size,
  }),
);
