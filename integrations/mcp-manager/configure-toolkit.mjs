#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { readToolkit, writeToolkit, projectToolkit } from './lib/toolkit-config.mjs';

export async function configure(argv = process.argv.slice(2)) {
  if (argv.length < 2 || argv[0] !== '--config' || typeof argv[1] !== 'string') {
    throw new Error('Usage: node configure-toolkit.mjs --config <manager.json> [--list | --add-root <id> <absolute-directory> | --remove-root <id>]');
  }
  const config = await loadConfig(argv[1]);
  const current = await readToolkit(config);
  const tail = argv.slice(2);
  if (tail.length === 0 || (tail.length === 1 && tail[0] === '--list')) {
    return projectToolkit(current);
  }
  if (tail.length === 3 && tail[0] === '--add-root') {
    const [id, requested] = tail.slice(1);
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id) || !path.isAbsolute(requested)) throw new Error('invalid_repository_root');
    const canonical = await fs.realpath(requested);
    const stat = await fs.stat(canonical);
    if (!stat.isDirectory() || path.parse(canonical).root === canonical) throw new Error('invalid_repository_root');
    const existing = current.roots.filter(root => root.id !== id);
    const updated = await writeToolkit(config, { ...current, roots: [...existing, { id, path: canonical }] });
    return { ok: true, toolkit: projectToolkit(updated), updatedRoot: id };
  }
  if (tail.length === 2 && tail[0] === '--remove-root') {
    const id = tail[1];
    if (!current.roots.some(root => root.id === id)) throw new Error('unknown_root_id');
    const updated = await writeToolkit(config, { ...current, roots: current.roots.filter(root => root.id !== id) });
    return { ok: true, toolkit: projectToolkit(updated), removedRoot: id };
  }
  throw new Error('invalid_toolkit_command');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  configure().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
