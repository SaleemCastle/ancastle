export interface ApiResponse<T> {
    data: T;
}

export interface PaginationMeta {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    meta: PaginationMeta;
}

export interface ApiErrorDetail {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
}

export interface ApiErrorResponse {
    error: ApiErrorDetail;
}
