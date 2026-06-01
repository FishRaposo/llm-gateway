/** Auth adapter - implements AuthPort using existing ApiKeyStore.
 * Infrastructure layer - wraps external storage with domain interface.
 */

import type { AuthPort, ApiKeyRecord, ApiKeyCreateInput } from "../../domain/ports/AuthPort";
import { ApiKeyStore } from "../../storage/apiKeyStore";

export class AuthAdapter implements AuthPort {
  private store: ApiKeyStore;

  constructor(dbPath: string) {
    this.store = new ApiKeyStore(dbPath);
  }

  async create(input: ApiKeyCreateInput): Promise<{ apiKey: string; record: ApiKeyRecord }> {
    return this.store.create(input);
  }

  async validate(apiKey: string): Promise<{ valid: boolean; record?: ApiKeyRecord }> {
    return this.store.validate(apiKey);
  }

  async list(): Promise<ApiKeyRecord[]> {
    return this.store.list();
  }

  async revoke(id: string): Promise<boolean> {
    return this.store.revoke(id);
  }
}
