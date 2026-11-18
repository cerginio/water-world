import { build } from 'vite';
import { resolve } from 'node:path';
import { projectRoot } from '../build/tilecraft-config.js';
import { verifyDist } from './verify-dist.mjs';

// The explicit config location also works when invoked from another directory.
await build({ configFile: resolve(projectRoot, 'vite.config.js') });
verifyDist();
