<script setup lang="ts">
import { computed } from 'vue'
import iconManifest from '../../assets/data/icon-manifest.json'

const props = withDefaults(defineProps<{
  unitId: string
  size?: number
  class?: string
}>(), {
  size: 24
})

const knownIcons = new Set<string>(iconManifest as string[])
const hasIcon = computed(() => knownIcons.has(props.unitId))
const iconSrc = computed(() => `${import.meta.env.BASE_URL}unitpics/${props.unitId}.png`)
</script>

<template>
  <img
    v-if="hasIcon"
    :src="iconSrc"
    :width="size"
    :height="size"
    :alt="unitId"
    class="object-contain inline-block shrink-0"
    :class="props.class"
  />
  <span
    v-else
    :style="{ width: size + 'px', height: size + 'px' }"
    class="inline-block shrink-0"
  />
</template>
