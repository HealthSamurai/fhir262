export interface Rest {
  // Type-level operation: POST /[type]/$op
  operation(
    resourceType: string,
    operation: string,
    params?: unknown,
  ): Promise<{ status: number; body: unknown }>;

  // System-level operation: POST /$op
  systemOperation(operation: string, params?: unknown): Promise<{ status: number; body: unknown }>;

  // Instance read: GET /[type]/[id]
  read(resourceType: string, id: string): Promise<{ status: number; body: unknown }>;

  // Type-level create: POST /[type]
  create(resourceType: string, resource: unknown): Promise<{ status: number; body: unknown }>;

  // Instance update: PUT /[type]/[id]
  update(
    resourceType: string,
    id: string,
    resource: unknown,
  ): Promise<{ status: number; body: unknown }>;

  // Instance delete: DELETE /[type]/[id]
  delete(resourceType: string, id: string): Promise<{ status: number; body: unknown }>;

  // Type-level search: GET /[type]?[query]
  search(resourceType: string, query?: string): Promise<{ status: number; body: unknown }>;
}
