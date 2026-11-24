<template>
  <p class="mb-3">A Process AAS binds a product recipe to a line’s resources and skills. These assignments are separate from product geometry and line placement.</p>

  <v-card class="mb-4" title="Write a Process AAS" variant="outlined">
    <v-card-text>
      <p class="text-body-small text-medium-emphasis mb-4">Choose a saved product and line to publish the assignments prepared in the Process Sequence editor.</p>

      <div class="d-flex ga-3 flex-wrap align-start">
        <v-autocomplete
          v-model="productId"
          :disabled="working || dirty"
          item-title="name"
          item-value="id"
          :items="products.map(item => ({ name: label(item.shell), id: item.shell.id }))"
          label="Product AAS"
        />

        <v-autocomplete
          v-model="systemId"
          :disabled="working || dirty"
          item-title="name"
          item-value="id"
          :items="systems.map(item => ({ name: label(item.shell), id: item.shell.id }))"
          label="Production system AAS"
        />

        <v-btn
          class="mt-2"
          :disabled="working || dirty || needsReload || !editable || !uploading || !productId || !systemId"
          :loading="writing"
          prepend-icon="mdi-file-link-outline"
          @click="$emit('write')"
        >Write</v-btn>
      </div>
    </v-card-text>
  </v-card>

  <v-card
    v-for="process in processes"
    :key="process.shell.id"
    class="mb-3"
    :subtitle="process.shell.id"
    :title="label(process.shell)"
    variant="outlined"
  >
    <v-card-text><div v-for="reference in children(submodel(process, 'ProcessInformation')).filter(node => node.modelType === 'ReferenceElement')" :key="reference.idShort"><strong>{{ reference.idShort }}:</strong> {{ reference.value?.keys?.map((key: Element) => key.value).join(' / ') }}</div></v-card-text>
    <v-card-actions><v-btn @click="$emit('inspect', process)">Inspect assignments and validation</v-btn></v-card-actions>
  </v-card>

  <v-empty-state v-if="processes.length === 0" title="No Process AASs found" />
</template>
<script setup lang="ts">
  import type { Element, Model } from './model'
  import { children, label, submodel } from './model'
  defineProps<{ products: Model[], systems: Model[], processes: Model[], working: boolean, dirty: boolean, needsReload: boolean, editable: boolean, uploading: boolean, writing: boolean }>()
  defineEmits<{ write: [], inspect: [model: Model] }>()
  const productId = defineModel<string>('productId')
  const systemId = defineModel<string>('systemId')
</script>
