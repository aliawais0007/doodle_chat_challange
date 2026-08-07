import { http, HttpResponse } from 'msw'

export const handlers = [
  // Placeholder handler so MSW is wired without implementing chat behavior yet.
  http.get('http://localhost:3000/health', () => {
    return HttpResponse.json({ status: 'ok' })
  }),
  http.get('http://localhost:3000/messages', () => {
    return HttpResponse.json([])
  }),
]
