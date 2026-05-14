export interface Rest {
  // Type-level operation: POST /[type]/$op
  operation(
    resourceType: string,
    operation: string,
    params?: unknown,
  ): Promise<{ status: number; body: unknown }>;

  // System-level operation: POST /$op
  systemOperation(operation: string, params?: unknown): Promise<{ status: number; body: unknown }>;
}
