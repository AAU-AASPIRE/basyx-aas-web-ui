<template>
  <v-row>
    <v-col class="catalog-column" cols="12" md="3">
      <v-text-field v-model="search" density="compact" label="Search module catalog" prepend-inner-icon="mdi-magnify" />

      <v-expansion-panels :model-value="groups.map((_, i) => i)" multiple>
        <v-expansion-panel v-for="group in groups" :key="group.id" :title="`${group.name} (${group.models.length})`">
          <v-expansion-panel-text>
            <v-card
              v-for="module in group.models"
              :key="module.shell.id"
              class="mb-2 pa-3 catalog-module"
              :color="picked === module.shell.id ? 'primary' : undefined"
              :draggable="!readonly"
              tabindex="0"
              variant="tonal"
              @click="picked = module.shell.id"
              @dragstart="start($event, module)"
              @keydown.enter="picked = module.shell.id"
            >
              <strong>{{ label(module.shell) }}</strong><div class="text-body-small">{{ (capabilities.get(module.shell.id) ?? []).some(cap => cap.availability === 'AfterReconfiguration') ? 'Planned capability' : 'Drag or select to place' }}</div>
              <v-btn size="x-small" variant="text" @click.stop="$emit('inspect', module)">AAS details</v-btn>
            </v-card>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-col>

    <v-col cols="12" md="9">
      <v-select
        v-if="tables.length > 1"
        v-model="tableId"
        item-title="name"
        item-value="id"
        :items="tables.map(item => ({ name: label(item.shell), id: item.shell.id }))"
        label="Planar table"
      />

      <v-btn-toggle
        v-if="geometry && table"
        v-model="view"
        class="mb-3"
        color="primary"
        density="compact"
        divided
        mandatory
        variant="outlined"
      >
        <v-btn prepend-icon="mdi-floor-plan" value="modules">Modules</v-btn>
        <v-btn prepend-icon="mdi-vector-polyline" value="routing">Shuttle routing</v-btn>
      </v-btn-toggle>

      <RoutingEditor
        v-if="view === 'routing' && frame"
        :frame="frame"
        :modules="placed.map(item => ({ name: label(item.model.shell), pose: item.pose }))"
        :readonly="readonly"
        :system="system"
        :xbots="shuttles"
        @change="$emit('change', $event)"
      />

      <p v-if="view === 'modules'" class="mb-3">Drag a module onto a perimeter zone, or select it and click an empty zone. Coordinates are in millimetres relative to the table base.</p>

      <div
        v-if="view === 'modules' && geometry && table"
        ref="board"
        aria-label="Production line layout"
        class="line-board"
        :style="{ aspectRatio: `${geometry.width + 2 * geometry.pitch} / ${geometry.height + 2 * geometry.pitch}`, maxWidth: `calc(max(360px, 100vh - 440px) * ${(geometry.width + 2 * geometry.pitch) / (geometry.height + 2 * geometry.pitch)})` }"
        @click="dropAt($event, picked)"
        @dragend="over = ''"
        @dragleave="leaveBoard"
        @dragover="hoverAt"
        @drop.prevent="dropAt($event, $event.dataTransfer?.getData(dragType) ?? '')"
      >
        <svg aria-label="Magnet table" class="table-surface" :viewBox="`${-geometry.pitch} ${-geometry.pitch} ${geometry.width + 2 * geometry.pitch} ${geometry.height + 2 * geometry.pitch}`">
          <rect
            class="table-frame"
            :height="geometry.height"
            :width="geometry.width"
            x="0"
            y="0"
          />

          <rect
            v-for="cell in geometry.cells"
            :key="`${cell.x}:${cell.y}`"
            class="magnet-cell"
            :height="geometry.pitch"
            stroke-width="1"
            :width="geometry.pitch"
            :x="cell.x - geometry.pitch / 2"
            :y="geometry.height - cell.y - geometry.pitch / 2"
          />
        </svg>

        <button
          v-for="zone in zones"
          :key="zone.id"
          :aria-disabled="readonly || !picked"
          :aria-label="`Place selected module in ${zone.name}`"
          class="drop-zone"
          :class="{ 'zone-active': over === zone.id, 'zone-blocked': over === zone.id && blocked(zone.pose, picked) }"
          :style="box(zone.pose)"
          @click.stop="applyPlacement(zone.pose, picked)"
        >
          <span>{{ zone.name }}</span><v-icon v-if="picked && !blocked(zone.pose, picked)" icon="mdi-plus" size="small" />
        </button>

        <button
          v-for="item in placed"
          :key="item.model.shell.id"
          :aria-label="`Move ${label(item.model.shell)}`"
          class="placed-module"
          :class="{ selected: picked === item.model.shell.id }"
          :disabled="readonly"
          :draggable="!readonly"
          :style="box(item.pose)"
          @click.stop="picked = item.model.shell.id"
          @dragstart="start($event, item.model)"
        >
          <span>{{ label(item.model.shell) }}</span><small>{{ item.pose.x }}, {{ item.pose.y }} mm · {{ item.pose.yaw }}°</small>
        </button>
      </div>

      <v-alert v-else-if="!geometry || !table" type="info">This line needs a planar table with TableBase and regular Flyway coordinates to open the layout.</v-alert>

      <v-alert
        v-if="message"
        class="mt-3"
        density="compact"
        role="status"
        type="info"
      >{{ message }}</v-alert>

      <v-card
        v-if="active"
        class="mt-3"
        :subtitle="poseText(active)"
        :title="label(active.shell)"
        variant="tonal"
      >
        <v-card-actions><v-btn :disabled="readonly" @click="remove(active)">Remove from line</v-btn><v-btn @click="$emit('inspect', active)">Inspect resource AAS</v-btn></v-card-actions>
      </v-card>

      <v-expansion-panels v-if="view === 'modules' && geometry" class="mt-4">
        <v-expansion-panel :title="`Available module positions (${zones.length})`">
          <v-expansion-panel-text>
            <p class="text-body-small mb-3">ModuleBase relative to TableBase; X/Y in mm and yaw in degrees. Z, roll and pitch retain their AAS values.</p>

            <v-table density="compact"><thead><tr><th>Position</th><th>X</th><th>Y</th><th>Yaw</th><th>Occupancy</th><th>Placement</th></tr></thead>

              <tbody><tr v-for="zone in zones" :key="zone.id">
                <td>{{ zone.name }}</td><td>{{ zone.pose.x }}</td><td>{{ zone.pose.y }}</td><td>{{ zone.pose.yaw }}</td>
                <td>{{ occupants(zone.pose) || 'Available' }}</td>

                <td><v-btn
                  :aria-label="`Place module at ${zone.name}`"
                  :disabled="readonly || !picked || blocked(zone.pose, picked)"
                  size="small"
                  variant="text"
                  @click="applyPlacement(zone.pose, picked)"
                >Place here</v-btn></td>
              </tr></tbody>
            </v-table>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <v-expansion-panels class="mt-4"><v-expansion-panel :title="`Composition (${members.length} assets)`"><v-expansion-panel-text>
        <v-list-item v-for="member in members" :key="member.idShort" :subtitle="member.globalAssetId" :title="label(member)">
          <template #append><v-chip size="small">{{ models.some(model => asset(model) === member.globalAssetId) ? 'Resolved' : 'Unresolved · preserved' }}</v-chip></template>
        </v-list-item>
      </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>

      <p class="text-body-small mt-3">Module squares are schematic footprints. Saving changes the line composition and the placed modules’ AAS coordinates; it does not command the equipment.</p>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
  import type { Model, Pose } from './model'
  import { addMember, asset, children, coordinate, entry, kind, label, moduleCenter, offers, place, pose, tableFrame, tableGeometry } from './model'
  import RoutingEditor from './RoutingEditor.vue'
  const models = defineModel<Model[]>({ required: true })
  const props = defineProps<{ system: Model, readonly: boolean }>()
  const emit = defineEmits<{ inspect: [model: Model], change: [ids: string[]] }>()
  const dragType = 'application/x-basyx-configurator-module'
  const search = ref('')
  const picked = ref('')
  const tableId = ref('')
  const message = ref('')
  const over = ref('')
  const board = ref<HTMLElement>()
  const members = computed(() => children(entry(props.system)).filter(node => node.modelType === 'Entity'))
  const tables = computed(() => models.value.filter(model => coordinate(model, 'TableBase') && members.value.some(member => member.globalAssetId === asset(model))))
  const table = computed(() => tables.value.find(model => model.shell.id === tableId.value) ?? tables.value[0])
  const geometry = computed(() => table.value ? tableGeometry(table.value) : undefined)
  const frame = computed(() => table.value ? tableFrame(table.value) : undefined)
  // The table's shuttles: its self-managed parts (its flyways are co-managed).
  const shuttles = computed(() => table.value ? children(entry(table.value)).filter(node => node.entityType === 'SelfManagedEntity').length : 0)
  const view = ref<'modules' | 'routing'>('modules')
  const modules = computed(() => models.value.filter(model => kind(model) === 'Module' && coordinate(model, 'ModuleBase')))
  const capabilities = computed(() => new Map(modules.value.map(model => [model.shell.id, offers(model)])))
  const active = computed(() => modules.value.find(model => model.shell.id === picked.value))
  const groups = computed(() => {
    const grouped = new Map<string, { id: string, name: string, models: Model[] }>()
    for (const model of modules.value) {
      const available = capabilities.value.get(model.shell.id) ?? []
      if (!`${label(model.shell)} ${available.map(cap => cap.name).join(' ')}`.toLowerCase().includes(search.value.toLowerCase())) continue
      for (const cap of available.length > 0 ? available : [{ semanticIds: [kind(model)], name: 'Other modules' }]) {
        const id = cap.semanticIds.toSorted().join('|') || cap.name
        if (!grouped.has(id)) grouped.set(id, { id, name: cap.name, models: [] })
        grouped.get(id)!.models.push(model)
      }
    }
    return [...grouped.values()]
  })
  const placed = computed(() => table.value
    ? modules.value.flatMap(model => {
      const position = pose(model, table.value!)
      return position && members.value.some(member => member.globalAssetId === asset(model)) ? [{ model, pose: position }] : []
    })
    : [])
  function start (event: DragEvent, model: Model) {
    picked.value = model.shell.id
    event.dataTransfer?.setData(dragType, model.shell.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
  function box (position: Pose) {
    const g = geometry.value!
    const center = moduleCenter(position, g.pitch)
    return { left: `${(center.x + g.pitch / 2) / (g.width + 2 * g.pitch) * 100}%`, top: `${(g.height - center.y + g.pitch / 2) / (g.height + 2 * g.pitch) * 100}%`, width: `${g.pitch / (g.width + 2 * g.pitch) * 100}%`, height: `${g.pitch / (g.height + 2 * g.pitch) * 100}%` }
  }
  const zones = computed(() => {
    const g = geometry.value
    if (!g) return []
    const result: { id: string, name: string, pose: Pose }[] = []
    for (let x = g.pitch / 2, i = 1; x < g.width; x += g.pitch, i++) {
      result.push({ id: `north-${i}`, name: `North ${i}`, pose: { x, y: g.height, yaw: 180 } }, { id: `south-${i}`, name: `South ${i}`, pose: { x, y: 0, yaw: 0 } })
    }
    for (let y = g.pitch / 2, i = 1; y < g.height; y += g.pitch, i++) {
      result.push({ id: `west-${i}`, name: `West ${i}`, pose: { x: 0, y, yaw: -90 } }, { id: `east-${i}`, name: `East ${i}`, pose: { x: g.width, y, yaw: 90 } })
    }
    return result
  })
  function zoneAt (event: MouseEvent | DragEvent) {
    if (!geometry.value || !board.value) return
    const g = geometry.value, rect = board.value.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * (g.width + 2 * g.pitch) - g.pitch
    const y = g.height + g.pitch - (event.clientY - rect.top) / rect.height * (g.height + 2 * g.pitch)
    return zones.value.find(zone => {
      const center = moduleCenter(zone.pose, g.pitch)
      return Math.abs(center.x - x) <= g.pitch / 2 && Math.abs(center.y - y) <= g.pitch / 2
    })
  }
  function hoverAt (event: DragEvent) {
    if (props.readonly || !event.dataTransfer?.types.includes(dragType)) return
    event.preventDefault()
    const zone = zoneAt(event)
    over.value = zone?.id ?? ''
    event.dataTransfer.dropEffect = zone && !blocked(zone.pose, picked.value) ? 'move' : 'none'
  }
  function leaveBoard (event: DragEvent) {
    if (!board.value?.contains(event.relatedTarget as Node | null)) over.value = ''
  }
  function occupants (position: Pose) {
    const pitch = geometry.value?.pitch ?? 0
    const center = moduleCenter(position, pitch)
    return placed.value.filter(item => {
      const other = moduleCenter(item.pose, pitch)
      return Math.abs(other.x - center.x) < pitch - 0.01 && Math.abs(other.y - center.y) < pitch - 0.01
    }).map(item => label(item.model.shell)).join(', ')
  }
  function blocked (position: Pose, id: string) {
    const pitch = geometry.value?.pitch ?? 0
    const center = moduleCenter(position, pitch)
    return placed.value.some(item => {
      const other = moduleCenter(item.pose, pitch)
      return item.model.shell.id !== id && Math.abs(other.x - center.x) < pitch - 0.01 && Math.abs(other.y - center.y) < pitch - 0.01
    })
  }
  function dropAt (event: MouseEvent | DragEvent, id: string) {
    const zone = zoneAt(event)
    over.value = ''
    if (zone) applyPlacement(zone.pose, id)
    else message.value = 'Choose an empty perimeter zone.'
  }
  function applyPlacement (next: Pose, id: string) {
    if (props.readonly || !table.value) return
    const module = modules.value.find(item => item.shell.id === id)
    if (!module) return
    if (blocked(next, id)) {
      message.value = 'That zone overlaps another module.'
      return
    }
    try {
      place(module, table.value, next)
      addMember(props.system, module)
      picked.value = id
      emit('change', [module.shell.id, props.system.shell.id])
      message.value = `Placed ${label(module.shell)} at ${next.x}, ${next.y} mm. Save to publish the AAS changes.`
    } catch (error) {
      message.value = String(error)
    }
  }
  function remove (module: Model) {
    const root = entry(props.system)
    if (root) root.statements = children(root).filter(node => node.globalAssetId !== asset(module))
    emit('change', [props.system.shell.id])
    message.value = 'Removed from this line. The resource AAS is retained.'
  }
  function poseText (model: Model) {
    const position = table.value && pose(model, table.value)
    return position ? `${position.x}, ${position.y} mm · ${position.yaw}°` : 'Unplaced or relative to a different coordinate frame'
  }
</script>

<style scoped>
.catalog-column { max-height: max(450px, calc(100vh - 340px)); overflow-y: auto; }
.catalog-module { cursor: grab; user-select: none; }
.line-board { position: relative; width: 100%; background: rgb(var(--v-theme-surface-variant)); border: 2px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 6px; }
.table-surface { position: absolute; width: 100%; height: 100%; pointer-events: none; }
.magnet-cell { fill: #202221; stroke: #737878; }
.table-frame { fill: rgba(var(--v-theme-on-surface), .04); stroke: rgba(var(--v-theme-on-surface), .25); stroke-dasharray: 8 6; }
.drop-zone, .placed-module { position: absolute; border: 1px solid rgba(var(--v-border-color), .35); border-radius: 3px; padding: 6px; overflow: hidden; font-size: clamp(10px, 1vw, 14px); }
.drop-zone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), .6); border-style: dashed; }
.drop-zone.zone-active { z-index: 2; background: rgba(var(--v-theme-primary), .25); color: rgb(var(--v-theme-on-surface)); outline: 3px solid rgb(var(--v-theme-primary)); outline-offset: -3px; }
.drop-zone.zone-blocked { outline-color: rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), .2); }
.placed-module { background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); cursor: grab; user-select: none; }
.placed-module.selected { border: 2px solid rgb(var(--v-theme-primary)); background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, rgb(var(--v-theme-surface))); }
.placed-module span, .placed-module small { display: block; overflow-wrap: anywhere; }
.placed-module small { opacity: .7; margin-top: 4px; }
.placed-module:focus-visible, .drop-zone:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); z-index: 1; }
</style>
