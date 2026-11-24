<script setup lang="ts">
import { ref, onBeforeUnmount, defineAsyncComponent } from 'vue'
import EditorView from './views/EditorView.vue'
const WorkbenchView = defineAsyncComponent(() => import('./views/WorkbenchView.vue'))
const advanced = ref(location.hash.startsWith('#workbench'))
const update = () => { advanced.value = location.hash.startsWith('#workbench') }
window.addEventListener('hashchange', update); onBeforeUnmount(() => window.removeEventListener('hashchange', update))
</script>
<template><WorkbenchView v-if="advanced"/><EditorView v-else/></template>
