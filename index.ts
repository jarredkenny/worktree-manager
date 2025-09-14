#!/usr/bin/env bun

import { parseArgs, runCommand } from './src/cli';

async function main() {
  const parsedArgs = parseArgs(process.argv);
  await runCommand(parsedArgs);
}

main().catch(error => {
  console.error(`❌ Fatal error: ${error}`);
  process.exit(1);
});