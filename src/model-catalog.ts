export interface CodexModelMetadata {
  id: string;
  input: number;
  output: number;
  image: boolean;
}

export const CODEX_MODELS: ReadonlyArray<CodexModelMetadata> = [
  { id: "gpt-5.6-sol", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.6-terra", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.6-luna", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.5", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.2", input: 272_000, output: 128_000, image: true },
];
