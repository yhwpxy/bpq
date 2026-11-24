<script setup lang="ts">
import { t } from '../i18n'
import { workApi } from '../workApi'
import { ElMessage } from 'element-plus'
const props = defineProps<{ modelValue: any }>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()
const fields = ['requirements','acceptanceCriteria','inputs','outputs','constraints','assumptions','modules']
const labels: Record<string, [string,string]> = { requirements:['功能需求','Requirements'], acceptanceCriteria:['验收标准','Acceptance criteria'], inputs:['输入','Inputs'], outputs:['输出','Outputs'], constraints:['约束','Constraints'], assumptions:['假设','Assumptions'], modules:['模块','Modules'] }
function update(field: string, value: any) { emit('update:modelValue', { ...props.modelValue, [field]: value }) }
function item(field: string, index: number, key: string, value: any) { const rows = structuredClone(props.modelValue[field]); rows[index][key] = value; if(key==='text') rows[index].source='user_confirmed'; update(field, rows) }
async function confirm(id: string) { try { const { data } = await workApi.post('/goals/confirm', { goalSpec: props.modelValue, id }); emit('update:modelValue', data.goalSpec) } catch (e:any) { ElMessage.error(e.response?.data?.message || e.message) } }
function add(field: string) {
  const prefix: Record<string,string> = { requirements:'FR', acceptanceCriteria:'AC', inputs:'IN', outputs:'OUT', constraints:'CON', assumptions:'ASM', modules:'MOD' }
  const rows = structuredClone(props.modelValue[field]); let number = rows.length + 1; while (rows.some((r:any) => r.id === `${prefix[field]}-${String(number).padStart(2,'0')}`)) number++
  rows.push({ id:`${prefix[field]}-${String(number).padStart(2,'0')}`, text:t('新增条目','New item'), source:'user_confirmed',origin:'suggested',sourceLine:null, ...(field==='acceptanceCriteria'?{requirementRefs:[]}:{}), ...(['inputs','outputs'].includes(field)?{name:`value_${number}`,type:'string',required:true}:{}) }); update(field,rows)
}
</script>
<template><div v-if="modelValue" class="goal-editor">
 <div class="wb-fields"><label>{{t('标题','Title')}}<input aria-label="Goal title" :value="modelValue.title" @change="update('title',($event.target as HTMLInputElement).value)"/></label><label>{{t('目标','Goal')}}<textarea aria-label="Goal text" :value="modelValue.goal" @change="update('goal',($event.target as HTMLTextAreaElement).value)"/></label></div>
 <details v-for="field in fields" :key="field" :open="['requirements','acceptanceCriteria','assumptions'].includes(field)"><summary>{{t(...labels[field])}} <span class="wb-count">{{modelValue[field].length}}</span></summary>
  <div v-for="(row,index) in modelValue[field]" :key="row.id" class="goal-row">
   <div class="wb-row"><code>{{row.id}}</code><span class="provenance" :class="row.source">{{row.source}}{{row.sourceLine ? ` · L${row.sourceLine}` : ''}}</span><el-button v-if="row.source==='suggested'" size="small" @click="confirm(row.id)">{{t('确认建议','Confirm suggestion')}}</el-button><button class="wb-link" @click="update(field,modelValue[field].filter((_:any,i:number)=>i!==index))">{{t('删除','Remove')}}</button></div>
   <textarea :aria-label="row.id" :value="row.text" @change="item(field,Number(index),'text',($event.target as HTMLTextAreaElement).value)"/>
   <label v-if="field==='acceptanceCriteria'">{{t('关联需求','Requirement refs')}}<input :aria-label="`${row.id} references`" :value="row.requirementRefs.join(', ')" @change="item(field,Number(index),'requirementRefs',($event.target as HTMLInputElement).value.split(/[,，\s]+/).filter(Boolean))"/></label>
   <div v-if="['inputs','outputs'].includes(field)" class="wb-row"><input aria-label="Contract name" :value="row.name" @change="item(field,Number(index),'name',($event.target as HTMLInputElement).value)"/><select aria-label="Contract type" :value="row.type" @change="item(field,Number(index),'type',($event.target as HTMLSelectElement).value)"><option v-for="kind in ['string','number','boolean','object','array','file','any']">{{kind}}</option></select></div>
  </div><el-button size="small" @click="add(field)">{{t('添加条目','Add item')}}</el-button>
 </details>
</div></template>
