import { fileURLToPath } from 'node:url';
import { serveDist } from './static-server.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const server = await serveDist({ directory: fileURLToPath(new URL('../dist/', import.meta.url)),
  host: value('--host', '127.0.0.1'), port: Number(value('--port', '4173')) });
console.log(`Production preview: ${server.url}`);
