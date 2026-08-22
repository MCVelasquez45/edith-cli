// EDITH skills: reusable procedures defined as SKILL.md files (the same
// format TrueForge's git-backed skill system mounts, so these migrate
// cleanly once sandbox-mounted skills are enabled).
//
// Tiers (later tiers shadow earlier ones by name):
//   core       — shipped with EDITH        (<package>/skills)
//   user       — ~/.edith/skills
//   workspace  — <workspace>/.edith/skills
//
// Progressive disclosure: only name+description enter agent instructions;
// the body is loaded on demand through the read_skill capability tool.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userSkillsDir } from '../runtime/paths.js';

const PACKAGE_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const MAX_SKILL_BYTES = 24000;

export function coreSkillsDir() {
  return path.join(PACKAGE_ROOT, 'skills');
}

export async function discoverSkills({ workspace = null } = {}) {
  const tiers = [
    { source: 'core', dir: coreSkillsDir() },
    { source: 'user', dir: userSkillsDir() },
    ...(workspace ? [{ source: 'workspace', dir: path.join(workspace, '.edith', 'skills') }] : [])
  ];
  const byName = new Map();
  for (const tier of tiers) {
    for (const skill of await scanTier(tier)) {
      byName.set(skill.name, skill); // later tiers shadow earlier ones
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Scans skill dirs; supports one level of category nesting
// (skills/<name>/SKILL.md and skills/<category>/<name>/SKILL.md).
async function scanTier({ source, dir }, depth = 0) {
  const skills = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const file = path.join(skillDir, 'SKILL.md');
    try {
      const body = await fs.readFile(file, 'utf8');
      const meta = parseFrontmatter(body);
      skills.push({
        name: meta.name ?? entry.name,
        description: meta.description ?? firstLine(body),
        source,
        path: file
      });
    } catch {
      if (depth < 1) skills.push(...await scanTier({ source, dir: skillDir }, depth + 1));
    }
  }
  return skills;
}

export async function loadSkill(name, { workspace = null } = {}) {
  const skills = await discoverSkills({ workspace });
  const skill = skills.find((item) => item.name === name);
  if (!skill) {
    const available = skills.map((item) => item.name).join(', ') || '(none)';
    throw new Error(`Skill not found: ${name}. Available skills: ${available}`);
  }
  const body = await fs.readFile(skill.path, 'utf8');
  return {
    ...skill,
    body: body.length > MAX_SKILL_BYTES ? `${body.slice(0, MAX_SKILL_BYTES)}\n...(truncated)` : body
  };
}

export function skillsInstructionBlock(skills) {
  if (!skills.length) return '';
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return [
    '--- SKILLS ---',
    'Named procedures you can load with the read_skill tool when a task matches:',
    ...lines,
    'When a user request clearly matches a skill, load it first and follow it.'
  ].join('\n');
}

// Capability tool giving the agent on-demand access to full skill bodies.
export function makeReadSkillTool({ workspace, z }) {
  return {
    name: 'read_skill',
    title: 'Read skill',
    description: 'Load the full instructions of a named EDITH skill. Use when a task matches a listed skill.',
    safety: 'read',
    schema: { name: z.string().min(1).max(100) },
    async handler({ name }) {
      const skill = await loadSkill(name, { workspace });
      return { content: [{ type: 'text', text: skill.body }] };
    }
  };
}

function parseFrontmatter(body) {
  const match = body.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return meta;
}

function firstLine(body) {
  return body.replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '') ?? '';
}
