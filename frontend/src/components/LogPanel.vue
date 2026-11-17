<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRunStore } from '../stores/runStore'
import { NODE_STATUS_COLORS, NODE_STATUS_LABELS } from '../../../shared/constants.js'
import AppIcon from './AppIcon.vue'
const props=defineProps<{collapsed:boolean}>()
const emit=defineEmits<{toggle:[];focus:[id:string]}>()
const run=useRunStore(), container=ref<HTMLElement>()
const eventLabels:Record<string,string>={start:'开始',success:'成功',fail:'失败',retry:'重试',skip:'跳过',cancel:'停止'}
const counts=computed(()=>{const count:Record<string,number>={};for(const state of Object.values(run.nodeStates))count[state.status]=(count[state.status]||0)+1;return count})
watch(()=>run.logs.length,async()=>{await nextTick();container.value?.scrollTo({top:container.value.scrollHeight,behavior:'smooth'})})
function time(value:string){try{return new Date(value).toLocaleTimeString('zh-CN',{hour12:false})}catch{return value}}
</script>
<template><section class="log-panel" :class="{collapsed}">
 <div class="log-heading"><div class="log-title"><AppIcon name="terminal" :size="16"/><strong>运行日志</strong><span class="count-badge">{{run.logs.length}}</span></div><div class="status-legend"><span v-for="(color,key) in NODE_STATUS_COLORS" :key="key"><i :style="{background:color}"></i>{{NODE_STATUS_LABELS[key]}}<b v-if="counts[key]">{{counts[key]}}</b></span></div><button class="icon-button log-toggle" :title="collapsed?'展开日志':'收起日志'" @click="emit('toggle')"><AppIcon name="chevron" :size="15"/></button></div>
 <div v-show="!collapsed" ref="container" class="log-entries"><div v-if="!run.logs.length" class="logs-empty"><AppIcon name="terminal" :size="22"/><div>一切准备就绪<span>执行编排后，在这里查看每一步的运行记录</span></div></div><div v-for="log in run.logs" :key="log.seq" class="log-row" :class="'event-'+log.event" @click="emit('focus',log.nodeId)"><span class="log-time">{{time(log.time)}}</span><span class="log-event">{{eventLabels[log.event] || log.event}}</span><span class="log-node">{{log.nodeName}}</span><span class="log-message">{{log.message}}</span></div></div>
 <div class="run-progress"><div :style="{width:run.progress+'%',background:run.status==='FAILED'?'#f56c6c':run.status==='SUCCESS'?'#67c23a':'#4f6ef2'}"></div></div>
 <div class="log-footer"><span><i class="connection-dot"></i>{{run.active?'实时更新 · 500 ms':'本地模拟执行'}}<span v-if="run.error" class="text-danger"> · {{run.error}}</span></span><span class="mono">{{run.progress}}% <span class="muted">COMPLETE</span></span></div>
</section></template>
