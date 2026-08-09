import { ConnectorHealth } from '../models.js';

export class NotConfiguredConnector {
  constructor({ id, name, sourceType, capabilities = [] }) {
    this.id = id;
    this.name = name;
    this.sourceType = sourceType;
    this.capabilities = capabilities;
    this.readOnly = true;
  }

  async health() {
    return {
      id: this.id,
      name: this.name,
      sourceType: this.sourceType,
      accountIdentity: null,
      health: ConnectorHealth.NOT_CONFIGURED,
      capabilities: this.capabilities,
      readOnly: true,
      lastSync: null,
      detail: 'No authenticated read-only backend was discovered.'
    };
  }
}
