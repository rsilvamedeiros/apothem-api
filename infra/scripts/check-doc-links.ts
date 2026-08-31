import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globby } from 'globby';

/**
 * apothem-api's CLAUDE.md/README/module READMEs point into the sibling
 * apothem-ai repository for canonical docs (ADR-008 — no dedicated docs
 * repo yet). Those references silently rot if apothem-ai/docs is
 * reorganized, so this script resolves every `apothem-ai/...` path
 * mentioned in this repo's markdown against the sibling checkout and fails
 * if any target is missing.
 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SIBLING_ROOT = resolve(REPO_ROOT, '..', 'apothem-ai');
const DOC_REF_PATTERN = /apothem-ai\/[A-Za-z0-9_\-./]+\.md/g;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const markdownFiles = await globby(['**/*.md'], {
    cwd: REPO_ROOT,
    ignore: ['node_modules/**', 'dist/**'],
    absolute: true,
  });

  const siblingExists = await fileExists(SIBLING_ROOT);
  if (!siblingExists) {
    console.warn(
      `Sibling repository not found at ${SIBLING_ROOT} — skipping doc link check (nothing to validate against).`,
    );
    return;
  }

  const broken: { file: string; ref: string }[] = [];

  for (const file of markdownFiles) {
    const content = await readFile(file, 'utf-8');
    const refs = content.match(DOC_REF_PATTERN) ?? [];
    for (const ref of refs) {
      // Skip GitHub web URLs like github.com/apothem/apothem-ai/blob/main/...
      // — those aren't repo-relative paths and resolve on GitHub, not on disk.
      if (ref.includes('/blob/')) {
        continue;
      }
      const relativeToSibling = ref.replace(/^apothem-ai\//, '');
      const target = resolve(SIBLING_ROOT, relativeToSibling);
      if (!(await fileExists(target))) {
        broken.push({ file: file.replace(REPO_ROOT, '').replace(/^[/\\]/, ''), ref });
      }
    }
  }

  if (broken.length > 0) {
    console.error(`Found ${broken.length} broken apothem-ai doc reference(s):`);
    for (const { file, ref } of broken) {
      console.error(`  ${file} -> ${ref}`);
    }
    process.exit(1);
  }

  console.log(`All apothem-ai doc references resolved (checked ${markdownFiles.length} markdown file(s)).`);
}

main().catch((error: unknown) => {
  console.error('Doc link check failed:', error);
  process.exit(1);
});
