/**
 * Sentrix Plugin Interface (TypeScript)
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the contract every framework adapter must satisfy.
 * Implement this to bring any TypeScript agent framework into Sentrix.
 */

import { IAgent }         from '../interfaces/IAgent';
import { AgentRequest }   from '../interfaces/IAgentRequest';
import { AgentResponse }  from '../interfaces/IAgentResponse';
import { DiscoveryEntry } from '../interfaces/IAgentDiscovery';

// ── config ────────────────────────────────────────────────────────────────────

export interface PluginConfig {
  // Identity
  agentId:      string;
  owner:        string;
  name:         string;
  version:      string;
  description?: string;
  tags?:        string[];
  metadataUri?: string;

  // Network
  host?:     string;     // default: 'localhost'
  port?:     number;     // default: 8080
  protocol?: string;     // default: 'http'
  tls?:      boolean;

  // Discovery
  discoveryType?: 'local' | 'http' | 'gossip';
  discoveryUrl?:  string;
  discoveryKey?:  string;

  // Optional ANR signing key (32-byte hex)
  signingKey?: string;

  /**
   * Map Sentrix capability names → framework-native tool/function names.
   * e.g. { "getWeather": "weather_tool" }
   */
  capabilityMap?: Record<string, string>;
}

// ── capability descriptor ─────────────────────────────────────────────────────

export interface CapabilityDescriptor {
  /** Sentrix capability name (what callers use) */
  name:          string;
  description:   string;
  inputSchema?:  Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?:         string[];
  /** The native tool/function name inside the framework */
  nativeName:    string;
}

// ── plugin interface ──────────────────────────────────────────────────────────

export interface ISentrixPlugin<TAgent = unknown, TNativeInput = unknown, TNativeOutput = unknown> {
  readonly config: PluginConfig;

  /** Inspect the framework agent and return its capabilities. */
  extractCapabilities(agent: TAgent): CapabilityDescriptor[];

  /** AgentRequest → framework-native invocation input */
  translateRequest(req: AgentRequest, descriptor: CapabilityDescriptor): TNativeInput;

  /** Framework output → AgentResponse */
  translateResponse(nativeResult: TNativeOutput, requestId: string): AgentResponse;

  /** Execute the framework agent with the translated input. */
  invokeNative(
    agent:       TAgent,
    descriptor:  CapabilityDescriptor,
    nativeInput: TNativeInput,
  ): Promise<TNativeOutput>;

  /** Optional: validate request before dispatch. Return error string or null. */
  validateRequest?(req: AgentRequest, descriptor: CapabilityDescriptor): string | null;

  /** Optional: custom error handler. */
  onError?(req: AgentRequest, err: Error): AgentResponse;

  /** Wrap the framework agent and return an IAgent. */
  wrap(agent: TAgent): IAgent;
}

// ── base class (abstract) ─────────────────────────────────────────────────────

export abstract class SentrixPlugin<TAgent, TNativeInput, TNativeOutput>
  implements ISentrixPlugin<TAgent, TNativeInput, TNativeOutput>
{
  constructor(readonly config: PluginConfig) {}

  abstract extractCapabilities(agent: TAgent): CapabilityDescriptor[];
  abstract translateRequest(req: AgentRequest, d: CapabilityDescriptor): TNativeInput;
  abstract translateResponse(result: TNativeOutput, requestId: string): AgentResponse;
  abstract invokeNative(agent: TAgent, d: CapabilityDescriptor, input: TNativeInput): Promise<TNativeOutput>;

  validateRequest(_req: AgentRequest, _d: CapabilityDescriptor): string | null {
    return null;
  }

  onError(req: AgentRequest, err: Error): AgentResponse {
    return {
      requestId:    req.requestId,
      status:       'error',
      errorMessage: `[${err.name}] ${err.message}`,
      timestamp:    Date.now(),
    };
  }

  wrap(agent: TAgent): IAgent {
    const caps = this.extractCapabilities(agent);
    return new WrappedAgent(agent, this, caps, this.config);
  }
}

// ── wrapped agent ─────────────────────────────────────────────────────────────

export class WrappedAgent<TAgent, TNativeInput, TNativeOutput> implements IAgent {
  readonly agentId:     string;
  readonly owner:       string;
  readonly metadataUri: string | undefined;
  readonly metadata:    Record<string, unknown>;

  private readonly capMap: Map<string, CapabilityDescriptor>;

  constructor(
    private readonly agent:   TAgent,
    private readonly plugin:  SentrixPlugin<TAgent, TNativeInput, TNativeOutput>,
    capabilities:             CapabilityDescriptor[],
    config:                   PluginConfig,
  ) {
    this.agentId     = config.agentId;
    this.owner       = config.owner;
    this.metadataUri = config.metadataUri;
    this.metadata    = {
      name:        config.name,
      version:     config.version,
      description: config.description,
      tags:        config.tags,
    };
    this.capMap = new Map(capabilities.map(c => [c.name, c]));
  }

  getCapabilities(): string[] {
    return [...this.capMap.keys()];
  }

  async handleRequest(req: AgentRequest): Promise<AgentResponse> {
    const descriptor = this.capMap.get(req.capability);
    if (!descriptor) {
      return {
        requestId:    req.requestId,
        status:       'error',
        errorMessage: `Unknown capability: "${req.capability}". Available: ${[...this.capMap.keys()].join(', ')}`,
      };
    }

    const validationError = this.plugin.validateRequest?.(req, descriptor);
    if (validationError) {
      return { requestId: req.requestId, status: 'error', errorMessage: validationError };
    }

    try {
      const nativeInput  = this.plugin.translateRequest(req, descriptor);
      const nativeResult = await this.plugin.invokeNative(this.agent, descriptor, nativeInput);
      return this.plugin.translateResponse(nativeResult, req.requestId);
    } catch (err) {
      return this.plugin.onError!(req, err instanceof Error ? err : new Error(String(err)));
    }
  }

  async registerDiscovery(): Promise<void> {
    const { DiscoveryFactory } = await import('../discovery/DiscoveryFactory');
    const registry = DiscoveryFactory.create({
      type: (this.plugin.config.discoveryType as any),
      http: this.plugin.config.discoveryUrl
        ? { baseUrl: this.plugin.config.discoveryUrl, apiKey: this.plugin.config.discoveryKey }
        : undefined,
    });
    const entry: DiscoveryEntry = {
      agentId:      this.agentId,
      name:         this.plugin.config.name,
      owner:        this.owner,
      capabilities: this.getCapabilities(),
      network: {
        protocol: (this.plugin.config.protocol ?? 'http') as any,
        host:     this.plugin.config.host     ?? 'localhost',
        port:     this.plugin.config.port     ?? 8080,
        tls:      this.plugin.config.tls      ?? false,
      },
      health: { status: 'healthy', lastHeartbeat: new Date().toISOString(), uptimeSeconds: 0 },
      registeredAt: new Date().toISOString(),
    };
    await registry.register(entry);
    console.log(`[Sentrix] ${this.plugin.config.name} registered to ${this.plugin.config.discoveryType ?? 'local'} discovery`);
  }

  async unregisterDiscovery(): Promise<void> {
    const { DiscoveryFactory } = await import('../discovery/DiscoveryFactory');
    const registry = DiscoveryFactory.create({ type: (this.plugin.config.discoveryType as any) });
    await registry.unregister(this.agentId);
  }
}
