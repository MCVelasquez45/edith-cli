import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// EDITH-owned data home. Config stays in ~/.config/edith; runtime state,
// session index, skills, and logs live here so `edith` owns its runtime fully.
export function edithDataDir() {
  return process.env.EDITH_DATA_DIR ?? path.join(os.homedir(), '.edith');
}

export function runtimeDir() {
  return path.join(edithDataDir(), 'runtime');
}

export function runtimeStateFile() {
  return path.join(runtimeDir(), 'state.json');
}

export function runtimeDbPath() {
  return path.join(runtimeDir(), 'trueforge.sqlite');
}

export function logsDir() {
  return path.join(edithDataDir(), 'logs');
}

export function runtimeLogFile() {
  return path.join(logsDir(), 'trueforge.log');
}

export function sessionIndexFile() {
  return path.join(edithDataDir(), 'sessions.json');
}

export function userSkillsDir() {
  return path.join(edithDataDir(), 'skills');
}

export async function ensureEdithDirs() {
  await fs.mkdir(runtimeDir(), { recursive: true });
  await fs.mkdir(logsDir(), { recursive: true });
  await fs.mkdir(userSkillsDir(), { recursive: true });
  return edithDataDir();
}
