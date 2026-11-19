export interface ManagementActionState {
    error?: string;
    fields?: Record<string, string[]>;
    success?: string;
    resourceId?: string;
    outcomeUnknown?: boolean;
    refresh?: boolean;
}
