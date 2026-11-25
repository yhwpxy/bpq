import type {DomainTermEntry} from '../shared/types.ts';

export interface TerminologyDriftMatch {
  readonly termId: string;
  readonly boundedContext: string;
  readonly canonicalTerm: string;
  readonly matchedAlias: string;
  readonly excerpt: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderUbiquitousLanguageSection(
  terms: readonly DomainTermEntry[],
): string {
  if (terms.length === 0) {
    return '';
  }
  const lines = [
    '## DDD Ubiquitous Language Glossary (Strict Naming Contract)',
    'Always use the canonical domain terms below across specs, code comments, and task nodes:',
  ];
  for (const term of terms) {
    const aliases =
      term.forbiddenAliases.length > 0
        ? ` | Avoid: ${term.forbiddenAliases.join(', ')}`
        : '';
    lines.push(
      `- [${term.boundedContext}] **${term.canonicalTerm}** (${term.localLabel}): ${term.definition}${aliases}`,
    );
  }
  return lines.join('\n');
}

export function detectTerminologyDrift(
  text: string,
  terms: readonly DomainTermEntry[],
): readonly TerminologyDriftMatch[] {
  const source = text.trim();
  if (!source || terms.length === 0) {
    return [];
  }

  const matches: TerminologyDriftMatch[] = [];
  for (const term of terms) {
    for (const rawAlias of term.forbiddenAliases) {
      const alias = rawAlias.trim();
      if (!alias || alias.toLowerCase() === term.canonicalTerm.toLowerCase()) {
        continue;
      }
      const isAscii = /^[\x20-\x7e]+$/.test(alias);
      const regex = isAscii
        ? new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i')
        : new RegExp(escapeRegex(alias));
      const hit = regex.exec(source);
      if (hit) {
        const start = Math.max(0, hit.index - 24);
        const end = Math.min(source.length, hit.index + alias.length + 24);
        matches.push({
          termId: term.id,
          boundedContext: term.boundedContext,
          canonicalTerm: term.canonicalTerm,
          matchedAlias: alias,
          excerpt: source.slice(start, end).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return matches;
}
