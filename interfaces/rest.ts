export interface Rest {
  operation(
    resourceType: string,
    operation: string,
    params?: unknown,
  ): Promise<{ status: number; body: unknown }>;
}
