import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.join(root, 'src-tauri/target/release/bundle/nsis');
const files = (await readdir(bundle)).filter(name => name.endsWith('-setup.exe'));
if (files.length !== 1) throw new Error(`Expected one NSIS installer, found ${files.length}. Build before preparing downloads.`);
const destination = path.join(root, 'site/dist/downloads');
await mkdir(destination, { recursive: true });
const name = 'galpi-0.1.0-windows-x64-setup.exe';
await copyFile(path.join(bundle, files[0]), path.join(destination, name));
const content = await readFile(path.join(destination, name));
const hash = createHash('sha256').update(content).digest('hex');
await writeFile(path.join(destination, 'SHA256SUMS.txt'), `${hash}  ${name}\n`);
console.log(JSON.stringify({ file: name, bytes: content.length, sha256: hash }));
