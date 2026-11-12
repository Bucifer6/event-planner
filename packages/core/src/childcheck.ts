// A6: children are never recorded as persons — only an attending count per household.
// A planner or guest who types a child's details into a free-text question is warned.
const CHILD_TERMS =
  /\b(copi\w*|copil\w*|feti[tțăa]\w*|b[ăa]iat\w*|nepot\w*|nepoat\w*|botezat\w*|minor\w*)\b/i;
const AGE_PATTERN = /\b\d{1,2}\s*(ani|an)\b/i;
const NAME_AGE = /\b\w+\s+\d{1,2}\s*ani\b/i;

export function looksLikeChildData(text: string): boolean {
  return CHILD_TERMS.test(text) || AGE_PATTERN.test(text) || NAME_AGE.test(text);
}
