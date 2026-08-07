export const chatQueryKeys = {
  history: (pageSize: number) => ['chat', 'history', { pageSize }] as const,
  outgoing: () => ['chat', 'outgoing'] as const,
}