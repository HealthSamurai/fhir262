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

  // Type-level search via POST: POST /[type]/_search with body [query]
  // (application/x-www-form-urlencoded). Per-key URL-encoding is the
  // caller's responsibility — body is the same `&`-separated query string
  // as the GET form.
  searchPost(resourceType: string, query?: string): Promise<{ status: number; body: unknown }>;

  // Compartment search: GET /[compartmentType]/[id]/(*|[type])?[query]
  // resourceType "*" requests every compartment member resource type.
  compartmentSearch(
    compartmentType: string,
    id: string,
    resourceType: string | "*",
    query?: string,
  ): Promise<{ status: number; body: unknown }>;

  // Compartment search via POST: POST /[compartmentType]/[id]/[type]/_search
  // with body [query] (application/x-www-form-urlencoded). Note: POST form
  // of "*"-compartment is undefined in FHIR; pass a concrete resourceType.
  compartmentSearchPost(
    compartmentType: string,
    id: string,
    resourceType: string,
    query?: string,
  ): Promise<{ status: number; body: unknown }>;
}
