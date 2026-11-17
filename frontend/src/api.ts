import axios from 'axios'
export const api = axios.create({ baseURL: '/api', timeout: 15000 })
export function errorMessage(error: any) { return error?.response?.data?.message || error?.message || '请求未成功，请稍后重试' }
