// Metadata inference provider abstraction. The rest of WaveLead depends on
// this interface — never on Gemini/Emergent specifics — so we can swap the
// backend without changing submission logic.

import { COUNTRIES } from '@/lib/constants/countries';

export interface InferenceInput { channelName: string; description: string; }

export interface InferenceOutput {
  category: { value: string | null; confidence: number };
  language: { value: string | null; confidence: number };
  country:  { value: string | null; confidence: number }; // ISO-2 code
}

export interface MetadataInferenceProvider {
  readonly name: string;
  readonly inference_version: string;
  infer(input: InferenceInput): Promise<InferenceOutput | null>;
}

// Application-side thresholds (never inside the model).
export const CATEGORY_MIN_CONFIDENCE = 0.7;
export const LANGUAGE_MIN_CONFIDENCE = 0.8;
export const COUNTRY_MIN_CONFIDENCE  = 0.85;

// Supported ISO 639-1 languages we surface in the UI. Keep in sync with the
// submission form. Language codes stay lowercase.
export const SUPPORTED_LANGUAGES = [
  'en','es','pt','fr','de','it','id','ms','ar','hi','ur','bn','ta','fa','ru','tr','vi','th','ja','ko','zh','nl','pl','sv','uk',
] as const;

export function isValidCountry(code: string): boolean {
  return typeof code === 'string' && /^[A-Z]{2}$/.test(code) && COUNTRIES.some((c) => c.code === code);
}

export function isValidLanguage(code: string): boolean {
  return typeof code === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(code.toLowerCase());
}

export function applyThresholds(raw: InferenceOutput | null, allowedCategorySlugs: string[]): InferenceOutput {
  const empty: InferenceOutput = {
    category: { value: null, confidence: 0 },
    language: { value: null, confidence: 0 },
    country:  { value: null, confidence: 0 },
  };
  if (!raw) return empty;
  const cat = raw.category?.value && allowedCategorySlugs.includes(String(raw.category.value)) && raw.category.confidence >= CATEGORY_MIN_CONFIDENCE
    ? { value: String(raw.category.value), confidence: raw.category.confidence }
    : { value: null, confidence: raw.category?.confidence ?? 0 };
  const langLower = raw.language?.value ? String(raw.language.value).toLowerCase() : null;
  const lang = langLower && isValidLanguage(langLower) && raw.language.confidence >= LANGUAGE_MIN_CONFIDENCE
    ? { value: langLower, confidence: raw.language.confidence }
    : { value: null, confidence: raw.language?.confidence ?? 0 };
  const ctryUpper = raw.country?.value ? String(raw.country.value).toUpperCase() : null;
  const ctry = ctryUpper && isValidCountry(ctryUpper) && raw.country.confidence >= COUNTRY_MIN_CONFIDENCE
    ? { value: ctryUpper, confidence: raw.country.confidence }
    : { value: null, confidence: raw.country?.confidence ?? 0 };
  return { category: cat, language: lang, country: ctry };
}
