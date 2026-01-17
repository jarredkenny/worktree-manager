import { WorktreeManager } from './worktree';
import { CleanupManager } from './cleanup';

export interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const flags: Record<string, string | boolean> = {};
  const commandArgs: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const flagName = arg.substring(2);
      const nextArg = args[i + 1];
      
      if (nextArg && !nextArg.startsWith('--')) {
        flags[flagName] = nextArg;
        i++; 
      } else {
        flags[flagName] = true;
      }
    } else if (arg.startsWith('-')) {
      const flagName = arg.substring(1);
      flags[flagName] = true;
    } else {
      commandArgs.push(arg);
    }
  }

  return {
    command,
    args: commandArgs,
    flags
  };
}

export function printHelp(): void {
  console.log(`
🌳 Worktree Manager (wtm) - Git worktree management made simple

USAGE:
  wtm <command> [args] [flags]

COMMANDS:
  create <name> --from <base_branch>    Create a new worktree and spawn shell
  checkout <name>                       Create worktree from remote branch
  list                                  List all worktrees
  delete <name> [--force]               Delete a worktree
  cleanup [options]                     Find and delete merged worktrees
  help                                  Show this help message

CLEANUP OPTIONS:
  --base <branch>                       Base branch for merge detection (auto-detected)
  --dry-run                             Show what would be deleted without deleting
  --yes                                 Delete all merged worktrees without prompting

EXAMPLES:
  wtm create feature-auth --from main   Create worktree from main (spawns new shell)
  wtm create hotfix-123 --from master   Create worktree from master
  wtm checkout feature-auth             Create worktree from remote branch feature-auth
  wtm list                              Show all worktrees
  wtm delete feature-auth               Delete worktree
  wtm delete feature-auth --force       Force delete worktree
  wtm cleanup                           Find and delete merged worktrees interactively
  wtm cleanup --base main               Use main as base branch for merge detection
  wtm cleanup --dry-run                 Show what would be deleted
  wtm cleanup --yes                     Delete all merged worktrees without prompting

FEATURES:
  • Automatically fetches latest changes from base branch
  • Works only in bare git repositories
  • Creates new branch for each worktree
  • Spawns new shell in worktree after creation
  • Safe deletion with confirmation prompts
  • Clear status and error messages
  • Hook system: place executable scripts in bare repo root (e.g., post_create)
`);
}

export async function runCommand(parsedArgs: CliArgs): Promise<void> {
  const { command, args, flags } = parsedArgs;
  const manager = new WorktreeManager();

  try {
    switch (command) {
      case 'create':
        await handleCreate(manager, args, flags);
        break;
        
      case 'checkout': 
        await handleCheckout(manager, args);
        break;
        
      case 'list':
        await handleList(manager);
        break;
        
      case 'delete':
        await handleDelete(manager, args, flags);
        break;

      case 'cleanup':
        await handleCleanup(flags);
        break;

      case 'help':
      default:
        printHelp();
        break;
    }
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function handleCreate(manager: WorktreeManager, args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const name = args[0];
  const baseBranch = flags.from as string;

  if (!name) {
    throw new Error("Worktree name is required. Usage: wtm create <name> --from <base_branch>");
  }

  if (!baseBranch) {
    throw new Error("Base branch is required. Usage: wtm create <name> --from <base_branch>");
  }

  await manager.createWorktree(name, baseBranch);
}

async function handleCheckout(manager: WorktreeManager, args: string[]): Promise<void> {
  const name = args[0];

  if (!name) {
    throw new Error("Worktree name is required. Usage: wtm checkout <name>");
  }

  await manager.checkoutWorktree(name);
}

async function handleList(manager: WorktreeManager): Promise<void> {
  const worktrees = await manager.listWorktrees();
  manager.printWorktrees(worktrees);
}

async function handleDelete(manager: WorktreeManager, args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const name = args[0];
  const force = !!flags.force;

  if (!name) {
    throw new Error("Worktree name is required. Usage: wtm delete <name>");
  }

  await manager.deleteWorktree(name, force);
}

async function handleCleanup(flags: Record<string, string | boolean>): Promise<void> {
  const manager = new CleanupManager();

  await manager.run({
    baseBranch: flags.base as string | undefined,
    dryRun: !!flags['dry-run'],
    yes: !!flags.yes,
  });
}