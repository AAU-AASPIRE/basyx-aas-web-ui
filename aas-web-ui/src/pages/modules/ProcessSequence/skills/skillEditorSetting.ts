/**
 * Which skill editor a skill opens in: the classic one (SkillFlowGraph), the one in BPMN notation
 * (module ProcessSequenceBpmn), or both one under the other. The default is VITE_SKILL_EDITOR
 * (classic, bpmn or both; both when unset); a choice made in the BPMN editor is kept per browser.
 */
export type SkillEditorChoice = 'classic' | 'bpmn' | 'both'

const KEY = 'process-sequence.skill-editor'
const CHOICES: SkillEditorChoice[] = ['classic', 'bpmn', 'both']
const valid = (text: unknown): SkillEditorChoice | undefined => CHOICES.find(choice => choice === String(text ?? '').trim().toLowerCase())
export const DEFAULT_SKILL_EDITOR: SkillEditorChoice = valid(import.meta.env.VITE_SKILL_EDITOR) ?? 'both'

function stored (): SkillEditorChoice {
  try {
    return valid(globalThis.localStorage?.getItem(KEY)) ?? DEFAULT_SKILL_EDITOR
  } catch {
    return DEFAULT_SKILL_EDITOR
  }
}

/** Shared by both editors' plugins, so a change shows at once. */
export const skillEditor = ref<SkillEditorChoice>(stored())

export function setSkillEditor (choice: SkillEditorChoice): void {
  skillEditor.value = choice
  try {
    if (choice === DEFAULT_SKILL_EDITOR) {
      globalThis.localStorage?.removeItem(KEY)
    } else {
      globalThis.localStorage?.setItem(KEY, choice)
    }
  } catch {
    // Without storage the choice lasts until the page is reloaded.
  }
}
