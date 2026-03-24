import path from 'path';
import fs from 'fs-extra';
import { detectLanguage } from '../utils/detect-lang';
import { logger } from '../utils/logger';
import { spawn } from 'child_process';

interface RunOptions {
  port: string;
  transport: string;
}

export async function runCommand(agentName: string, options: RunOptions): Promise<void> {
  const projectDir = process.cwd();
  const lang = detectLanguage(projectDir);

  logger.title(`Starting ${agentName} on ${options.transport}://localhost:${options.port}`);

  const runners: Record<string, () => { cmd: string; args: string[] }> = {
    typescript: () => ({
      cmd: 'npx',
      args: ['ts-node', '-e',
        `const { ${agentName} } = require('./agents/${agentName}');
         const { AgentRunner } = require('./discovery/runner');
         const agent = new ${agentName}();
         new AgentRunner(agent, { port: ${options.port}, transport: '${options.transport}' }).start();`
      ]
    }),
    python: () => ({
      cmd: 'python',
      args: ['-c',
        `import asyncio
from agents.${agentName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')} import ${agentName}
from discovery.runner import AgentRunner
asyncio.run(AgentRunner(${agentName}(), port=${options.port}).start())`
      ]
    }),
    rust: () => ({ cmd: 'cargo', args: ['run', '--', agentName, options.port] }),
    zig:  () => ({ cmd: 'zig', args: ['build', 'run', '--', agentName, options.port] }),
  };

  const runnerFn = runners[lang];
  if (!runnerFn) {
    logger.error(`No runner configured for language "${lang}".`);
    process.exit(1);
  }

  const { cmd, args } = runnerFn();
  const proc = spawn(cmd, args, { stdio: 'inherit', cwd: projectDir });

  proc.on('error', (err) => {
    logger.error(`Failed to start agent: ${err.message}`);
    process.exit(1);
  });
  proc.on('exit', (code) => {
    if (code !== 0) {
      logger.error(`Agent exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });
}
