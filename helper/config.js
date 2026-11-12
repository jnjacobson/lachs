// Reads ~/.config/lachs/config.json.
// CLI for lachs-zed init: node helper/config.js zed-init
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
export const CONFIG_FILE =
  process.env.LACHS_CONFIG ?? path.join(HOME, '.config', 'lachs', 'config.json');
export const DEFAULT_CLAUDE_CONFIG_DIR = path.join(HOME, '.claude');

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'zed-init') throw new TypeError('usage: config.js zed-init');
  try {
    console.log(zedInitSettings(process.cwd()).join('\n'));
  } catch (error) {
    console.error(`lachs: ${error.message}`);
    process.exit(1);
  }
}

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

// "~/bin/x" and paths relative to the home folder work too.
export function homePath(name) {
  return path.resolve(HOME, name.replace(/^~(?=\/|$)/, HOME));
}

// Every Claude config dir to search for sessions. ~/.claude is always one.
export function claudeConfigDirs() {
  const dirs = claudeConfigDirMapping().map(({ configDir }) => configDir);
  return [...new Set([DEFAULT_CLAUDE_CONFIG_DIR, ...dirs])];
}

// Claude reads ~/.claude.json instead of <dir>/.claude.json when CLAUDE_CONFIG_DIR is unset,
// so the default dir must stay unset rather than be set to ~/.claude.
export function claudeEnv(configDir, env = process.env) {
  const { CLAUDE_CONFIG_DIR, ...rest } = env;
  return configDir === DEFAULT_CLAUDE_CONFIG_DIR ? rest : { ...rest, CLAUDE_CONFIG_DIR: configDir };
}

export function claudeGlobalConfigFile(configDir) {
  return configDir === DEFAULT_CLAUDE_CONFIG_DIR
    ? path.join(HOME, '.claude.json')
    : path.join(configDir, '.claude.json');
}

// "claudeConfigDirs" maps project folders to the Claude config dir used there,
// e.g. { "~/projects/private": "~/.claude-private" }.
function claudeConfigDirMapping() {
  const mapping = readConfig().claudeConfigDirs ?? {};
  const entries = Object.entries(mapping);
  if (
    typeof mapping !== 'object' ||
    Array.isArray(mapping) ||
    entries.some(([, dir]) => typeof dir !== 'string' || dir === '')
  ) {
    throw new Error(
      `"claudeConfigDirs" in ${CONFIG_FILE} must map project folders to Claude config dirs, e.g. { "~/projects/private": "~/.claude-private" }.`,
    );
  }
  return entries.map(([folder, dir]) => ({
    folder: realPath(homePath(folder)),
    configDir: homePath(dir),
  }));
}

// Two lines: the "shell" value, and how a new session in `cwd` sets CLAUDE_CONFIG_DIR:
// empty to keep it, "CLAUDE_CONFIG_DIR=" to unset it, or "CLAUDE_CONFIG_DIR=<dir>".
function zedInitSettings(cwd) {
  const { shell } = readConfig();
  const mapping = claudeConfigDirMapping();
  let configDirLine = '';
  if (mapping.length > 0) {
    const deepest = mapping
      .filter(({ folder }) => `${cwd}/`.startsWith(`${folder}/`))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
    const env = claudeEnv(deepest?.configDir ?? DEFAULT_CLAUDE_CONFIG_DIR, {});
    configDirLine = `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR ?? ''}`;
  }
  return [typeof shell === 'string' ? shell : '', configDirLine];
}

// process.cwd() has symlinks resolved, so the mapped folders need the same.
function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
