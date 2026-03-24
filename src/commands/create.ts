import path from 'path';
import fs from 'fs-extra';
import ora from 'ora';
import { detectLanguage } from '../utils/detect-lang';
import { logger } from '../utils/logger';

interface CreateOptions {
  lang?: string;
  capabilities: string;
}

const AGENT_TEMPLATES: Record<string, (name: string, caps: string[]) => string> = {

  typescript: (name, caps) => `import { IAgent } from '../interfaces/IAgent';
import { AgentRequest } from '../interfaces/IAgentRequest';
import { AgentResponse } from '../interfaces/IAgentResponse';

export class ${name} implements IAgent {
  agentId  = 'sentrix://agent/${name.toLowerCase()}';
  owner    = '0xYourWalletAddress';
  metadata = { name: '${name}', version: '0.1.0', tags: [${caps.map(c => `'${c}'`).join(', ')}] };

  getCapabilities(): string[] {
    return [${caps.map(c => `'${c}'`).join(', ')}];
  }

  async handleRequest(req: AgentRequest): Promise<AgentResponse> {
    switch (req.capability) {
${caps.map(c => `      case '${c}':\n        return { requestId: req.requestId, status: 'success', result: { message: '${c} called' } };`).join('\n')}
      default:
        return { requestId: req.requestId, status: 'error', errorMessage: \`Unknown capability: \${req.capability}\` };
    }
  }

  async registerDiscovery(): Promise<void> {
    // TODO: plug in your discovery adapter
    console.log('[${name}] registered with discovery layer');
  }
}
`,

  python: (name, caps) => `from interfaces.iagent import IAgent
from interfaces.agent_request import AgentRequest
from interfaces.agent_response import AgentResponse
from typing import List

class ${name}(IAgent):
    agent_id = 'sentrix://agent/${name.lower()}'
    owner    = '0xYourWalletAddress'
    metadata = {'name': '${name}', 'version': '0.1.0', 'tags': [${caps.map(c => `'${c}'`).join(', ')}]}

    def get_capabilities(self) -> List[str]:
        return [${caps.map(c => `'${c}'`).join(', ')}]

    async def handle_request(self, req: AgentRequest) -> AgentResponse:
        handlers = {
${caps.map(c => `            '${c}': lambda r: AgentResponse(request_id=r.request_id, status='success', result={'message': '${c} called'})`).join(',\n')}
        }
        handler = handlers.get(req.capability)
        if handler:
            return handler(req)
        return AgentResponse(request_id=req.request_id, status='error', error_message=f'Unknown capability: {req.capability}')

    async def register_discovery(self) -> None:
        print(f'[${name}] registered with discovery layer')
`,

  rust: (name, caps) => `use crate::agent::{IAgent, AgentRequest, AgentResponse};
use async_trait::async_trait;

pub struct ${name};

#[async_trait]
impl IAgent for ${name} {
    fn agent_id(&self) -> &str { "sentrix://agent/${name.toLowerCase()}" }
    fn owner(&self)    -> &str { "0xYourWalletAddress" }

    fn get_capabilities(&self) -> Vec<String> {
        vec![${caps.map(c => `"${c}".to_string()`).join(', ')}]
    }

    async fn handle_request(&self, req: AgentRequest) -> AgentResponse {
        match req.capability.as_str() {
${caps.map(c => `            "${c}" => AgentResponse::success(req.request_id, serde_json::json!({ "message": "${c} called" }))`).join(',\n')},
            _ => AgentResponse::error(req.request_id, format!("Unknown capability: {}", req.capability)),
        }
    }

    async fn register_discovery(&self) -> Result<(), Box<dyn std::error::Error>> {
        println!("[${name}] registered with discovery layer");
        Ok(())
    }
}
`,

  zig: (name, caps) => `const std = @import("std");
const types = @import("../interfaces/types.zig");
const IAgent = @import("../interfaces/iagent.zig").IAgent;

pub const ${name} = struct {
    agent_id: []const u8 = "sentrix://agent/${name.toLowerCase()}",
    owner:    []const u8 = "0xYourWalletAddress",

    pub fn getCapabilities(_: *const ${name}) []const []const u8 {
        return &.{ ${caps.map(c => `"${c}"`).join(', ')} };
    }

    pub fn handleRequest(_: *const ${name}, req: types.AgentRequest) types.AgentResponse {
        ${caps.map((c, i) => `${i === 0 ? 'if' : '} else if'} (std.mem.eql(u8, req.capability, "${c}")) {
            return .{ .request_id = req.request_id, .status = "success", .result = "${c} called" };`).join('\n        ')}
        } else {
            return .{ .request_id = req.request_id, .status = "error", .result = "Unknown capability" };
        }
    }

    pub fn registerDiscovery(_: *const ${name}) void {
        std.log.info("[${name}] registered with discovery layer", .{});
    }
};
`,
};

export async function createCommand(
  agentName: string,
  options: CreateOptions
): Promise<void> {
  const projectDir = process.cwd();
  const lang = options.lang ?? detectLanguage(projectDir);
  const caps = options.capabilities.split(',').map(c => c.trim()).filter(Boolean);

  const agentsDir = path.join(projectDir, 'agents');
  if (!fs.existsSync(agentsDir)) {
    logger.error('No "agents/" folder found. Are you inside a Sentrix project? Run sentrix init first.');
    process.exit(1);
  }

  const templateFn = AGENT_TEMPLATES[lang];
  if (!templateFn) {
    logger.error(`No agent template for language "${lang}".`);
    process.exit(1);
  }

  const extensions: Record<string, string> = {
    typescript: '.ts', python: '.py', rust: '.rs', zig: '.zig'
  };
  const ext = extensions[lang];
  const fileName = lang === 'python'
    ? agentName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + ext
    : agentName + ext;

  const destPath = path.join(agentsDir, fileName);

  if (fs.existsSync(destPath)) {
    logger.error(`Agent file "${fileName}" already exists.`);
    process.exit(1);
  }

  const spinner = ora(`Generating ${agentName} [${lang}]...`).start();
  await fs.writeFile(destPath, templateFn(agentName, caps), 'utf8');
  spinner.succeed(`Agent created: agents/${fileName}`);
  logger.info(`Capabilities: ${caps.join(', ')}`);
}
