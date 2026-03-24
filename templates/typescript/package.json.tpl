{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "description": "Sentrix agent project — ERC-8004 compliant",
  "scripts": {
    "dev": "ts-node agents/ExampleAgent.ts",
    "build": "tsc",
    "start": "node dist/agents/ExampleAgent.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
