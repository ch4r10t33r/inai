"""
Sentrix Framework Plugins
────────────────────────
Lightweight adapter layers for integrating third-party agent frameworks
into the Sentrix network without rewriting agents.

Available plugins:
  - LangGraphPlugin   (langgraph_plugin.py)  wrap_langgraph()
  - GoogleADKPlugin   (google_adk_plugin.py) wrap_google_adk()

Adding a new framework:
  1. Create  plugins/my_framework_plugin.py
  2. Subclass SentrixPlugin (base.py)
  3. Implement the four abstract methods
  4. Export a wrap_my_framework() convenience function

See base.py for the full interface contract.
"""

from .base import SentrixPlugin, PluginConfig, CapabilityDescriptor, WrappedAgent

__all__ = [
    "SentrixPlugin",
    "PluginConfig",
    "CapabilityDescriptor",
    "WrappedAgent",
]
