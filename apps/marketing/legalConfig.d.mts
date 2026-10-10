export declare const LEGAL_VARIABLES: readonly string[];
export declare const LEGAL_NOT_CONFIGURED_WARNING: string;
export declare const LEGAL_PAGE_PATHS: readonly string[];
export declare function sitemapWithoutLegalPages(xml: string): string;
export declare function checkLegalConfig(env: Record<string, string | undefined>): { configured: boolean; problems: string[] };
