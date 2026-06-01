/** Auth port - interface for API key management.
 * Domain defines the contract, infrastructure implements it.
 */

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyHash: string;
  permissions: string[];
  budgetUsd: number;
  allowedModels: string[];
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreateInput {
  name: string;
  permissions?: string[];
  budgetUsd?: number;
  allowedModels?: string[];
  expiresAt?: string | null;
}

export interface AuthPort {
  create(input: ApiKeyCreateInput): Promise<{ apiKey: string; record: ApiKeyRecord }>;

  validate(apiKey: string): Promise<{ valid: boolean; record?: ApiKeyRecord }>;

  list(): Promise<ApiKeyRecord[]>;

  revoke(id: string): Promise<boolean>;
}
