<template>
  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card aria-label="Match and plan">
      <v-card-title class="d-flex align-center">
        Match and plan
        <v-spacer />

        <v-btn
          aria-label="Close match and plan"
          icon="mdi-close"
          size="small"
          variant="text"
          @click="open = false"
        />
      </v-card-title>

      <v-card-text>
        <p class="text-body-small mb-3">
          {{ summary }} A planned skill is described in the module's AAS, not built: the module offers it once
          <code>modsync reconfigure</code> has built it. Save the draft to keep the bindings.
        </p>

        <v-card
          v-for="outcome in outcomes"
          :key="outcome.stepId"
          :aria-label="outcome.step"
          border
          class="mb-2"
          rounded="lg"
          variant="flat"
        >
          <div class="d-flex align-center flex-wrap ga-2 pa-3">
            <span class="text-body-small font-weight-bold">{{ outcome.step }}</span>
            <v-chip :color="kinds[outcome.kind].color" :prepend-icon="kinds[outcome.kind].icon" size="small">{{ kinds[outcome.kind].title }}</v-chip>
            <v-spacer />
            <span v-if="outcome.resource" class="text-body-small">{{ outcome.resource }} · {{ outcome.skill }}</span>
          </div>

          <div v-if="outcome.notes.length > 0" class="px-3 pb-2">
            <p v-for="note in outcome.notes" :key="note" class="text-body-small mb-1">{{ note }}</p>
          </div>
        </v-card>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import type { Outcome } from '../utils/matchAndPlan'

  const props = defineProps<{ outcomes: Outcome[] }>()
  const open = defineModel<boolean>({ required: true })
  const kinds: Record<Outcome['kind'], { title: string, color: string, icon: string }> = {
    kept: { title: 'Already bound', color: 'default', icon: 'mdi-link-variant' },
    bound: { title: 'Matched', color: 'success', icon: 'mdi-check' },
    checked: { title: 'Matched and checked', color: 'success', icon: 'mdi-check-decagram' },
    planned: { title: 'Planned', color: 'info', icon: 'mdi-auto-fix' },
    none: { title: 'Not found', color: 'warning', icon: 'mdi-alert-outline' },
    manual: { title: 'Manual', color: 'default', icon: 'mdi-hand-back-right-outline' },
  }
  const summary = computed(() => {
    const count = (kind: Outcome['kind']) => props.outcomes.filter(outcome => outcome.kind === kind).length
    const bound = count('bound') + count('checked')
    return `${bound} step${bound === 1 ? '' : 's'} matched, ${count('planned')} planned, ${count('none')} without a resource.`
  })
</script>
