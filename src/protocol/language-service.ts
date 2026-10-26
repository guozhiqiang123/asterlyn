export interface LanguageServiceReview { readonly reviewId: string; readonly pluginId: string; readonly serverId: "typescript"; }
export interface LanguageServiceTextPosition { readonly line: number; readonly character: number; }
export interface LanguageServiceTextRange { readonly start: LanguageServiceTextPosition; readonly end: LanguageServiceTextPosition; }
export interface LanguageServiceTextChange { readonly range: LanguageServiceTextRange | null; readonly text: string; }
export interface LanguageServiceResultEnvelope { readonly sessionId: string; readonly uri: string; readonly version: number; readonly result: unknown; }
