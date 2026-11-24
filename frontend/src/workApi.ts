import axios from 'axios'
export const workApi = axios.create({ baseURL: '/api', timeout: 60000 })
let token = '', pending: Promise<string> | undefined
workApi.interceptors.request.use(async config => {
  if (!token) {
    pending ||= axios.get('/api/local-session').then(r => r.data.token as string).finally(() => { pending = undefined })
    token = await pending
  }
  config.headers.Authorization = `Bearer ${token}`; return config
})
workApi.interceptors.response.use(r => r, e => { if (e.response?.status === 401) token = ''; return Promise.reject(e) })
export function downloadFile(name: string, data: unknown, mime = 'application/json') {
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const url = URL.createObjectURL(new Blob([content], { type: mime })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
