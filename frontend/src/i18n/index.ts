import { ref } from 'vue'
export const language = ref<'zh' | 'en'>(localStorage.getItem('vto.language') === 'en' ? 'en' : 'zh')
export const t = (zh: string, en: string) => language.value === 'zh' ? zh : en
export function toggleLanguage() { language.value = language.value === 'zh' ? 'en' : 'zh'; localStorage.setItem('vto.language', language.value) }
export function displayStatus(status: string) {
  const map: Record<string, [string,string]> = { PENDING:['待执行','Pending'], READY:['就绪','Ready'], RUNNING:['运行中','Running'], PAUSED:['已暂停','Paused'], WAITING_HUMAN:['等待人工','Awaiting decision'], SUCCESS:['成功','Succeeded'], FAILED:['失败','Failed'], SKIPPED:['已跳过','Skipped'], CANCELED:['已取消','Cancelled'], WAIVED:['已豁免','Waived'], REWOUND:['已恢复','Restored'] }
  const value = map[status]; return value ? t(...value) : status
}
