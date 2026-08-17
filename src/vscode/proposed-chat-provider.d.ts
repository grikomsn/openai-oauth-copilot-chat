declare module "vscode" {
  export interface ProvideLanguageModelChatResponseOptions {
    readonly requestInitiator: string;
    readonly modelConfiguration?: { readonly [key: string]: unknown };
  }

  export interface LanguageModelChatInformation {
    readonly requiresAuthorization?: true | { label: string };
    readonly pricing?: string;
    readonly isUserSelectable?: boolean;
    readonly configurationSchema?: LanguageModelConfigurationSchema;
    readonly targetChatSessionType?: string;
  }

  export interface LanguageModelChatCapabilities {
    readonly imageInput?: boolean;
    readonly toolCalling?: boolean | number;
  }

  export type LanguageModelResponsePart2 =
    | LanguageModelResponsePart
    | LanguageModelDataPart
    | LanguageModelThinkingPart;

  export type LanguageModelConfigurationSchema = {
    readonly type?: "object";
    readonly properties?: {
      readonly [key: string]: Record<string, unknown> & {
        readonly enumItemLabels?: string[];
        readonly enumDescriptions?: string[];
        readonly group?: string;
      };
    };
  };

  export interface LanguageModelChatProvider<
    T extends LanguageModelChatInformation = LanguageModelChatInformation,
  > {
    provideLanguageModelChatInformation(
      options: PrepareLanguageModelChatModelOptions,
      token: CancellationToken,
    ): ProviderResult<T[]>;
    provideLanguageModelChatResponse(
      model: T,
      messages: readonly LanguageModelChatRequestMessage[],
      options: ProvideLanguageModelChatResponseOptions,
      progress: Progress<LanguageModelResponsePart2>,
      token: CancellationToken,
    ): Thenable<void>;
  }

  export interface PrepareLanguageModelChatModelOptions {
    readonly silent?: boolean;
    readonly configuration?: { readonly [key: string]: unknown };
  }
}
