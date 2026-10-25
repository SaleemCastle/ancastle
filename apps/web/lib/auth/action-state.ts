export interface AuthActionState {
    error?: string;
    fields?: { email?: string[]; password?: string[] };
}
