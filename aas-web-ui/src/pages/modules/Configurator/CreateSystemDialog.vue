<template>
  <v-dialog v-model="open" max-width="580">
    <v-card title="Create production line AAS">
      <v-card-text>
        <v-text-field v-model="name" label="Line name" />
        <v-text-field v-model="id" label="Line AAS identifier" />

        <v-select
          v-model="tableId"
          item-title="name"
          item-value="id"
          :items="tables.map(table => ({ name: label(table.shell), id: table.shell.id }))"
          label="Planar table"
        />

        <p>The line references this table and the modules you add from the catalog. Existing resource identities and their coordinates are shared.</p>
        <v-alert v-if="error" class="mt-3" type="warning">{{ error }}</v-alert>
      </v-card-text>

      <v-card-actions><v-btn @click="open = false">Cancel</v-btn><v-spacer /><v-btn :disabled="!name.trim() || !id.trim() || !tableId" @click="create">Create line draft</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import type { Model } from './model'
  import { label, newSystem } from './model'
  const open = defineModel<boolean>({ default: false })
  const props = defineProps<{ tables: Model[], existingIds: string[] }>()
  const emit = defineEmits<{ create: [model: Model] }>()
  const name = ref('')
  const id = ref(`urn:uuid:${crypto.randomUUID()}`)
  const tableId = ref('')
  const error = ref('')
  watch(open, active => {
    if (active) {
      name.value = ''
      id.value = `urn:uuid:${crypto.randomUUID()}`
      tableId.value = props.tables[0]?.shell.id ?? ''
      error.value = ''
    }
  })
  function create () {
    try {
      if (props.existingIds.includes(id.value.trim())) throw new Error('That AAS identifier already exists.')
      const table = props.tables.find(model => model.shell.id === tableId.value)
      if (!table) throw new Error('Select an available table.')
      emit('create', newSystem(name.value, id.value.trim(), table))
      open.value = false
    } catch (error_) {
      error.value = String(error_)
    }
  }
</script>
