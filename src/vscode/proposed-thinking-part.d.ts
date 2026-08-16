declare module "vscode" {
  export class LanguageModelThinkingPart {
    value: string | string[];
    id?: string;
    metadata?: Record<string, unknown>;
    constructor(value: string | string[], id?: string, metadata?: Record<string, unknown>);
  }
}
