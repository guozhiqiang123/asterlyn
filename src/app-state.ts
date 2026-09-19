export interface AppState {
  loading: boolean;
  error: string | null;
}

export function createAppState(): AppState {
  return {
    loading: false,
    error: null,
  };
}
