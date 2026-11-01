// The dashboard's messages (messages/<locale>/dashboard.json) as next-intl's translator reads them:
// useTranslations('dashboard') in the components, createTranslator in the tests. Plain functions
// (the built-in report, the data sources, saved reports) take it as `t` and stay free of React.
export type Translate = (key: string, values?: Record<string, string | number>) => string;
