# Process Sequence (BPMN)

The planner and the skill editor with their flows drawn in BPMN notation. Next to the Process
Sequence module and the classic skill editor, not instead of them: both read and write the same
AAS data (a product's Production Sequence, a resource's ARSO Skills), so the same plans and skills
open in either, and removing this module leaves the others as they are.

## What is drawn

| Flow | BPMN |
| --- | --- |
| Start, end of a sequence | start event, end event |
| A step | service task (the gear marker): a skill does the work |
| A call of a subprocess | call activity (thick border, + marker) |
| Parallel block | a pair of AND gateways (+): split, and its join |
| Decision | a pair of XOR gateways (×); the yes branch carries the condition, the other is "otherwise" |
| Conditional steps | a pair of XOR gateways: run when the condition holds, otherwise skip |

The first branch of a block goes on along the line, the others below it. Editing is by blocks only
("Add step", "Add a block", on a selected sequence flow or after a selected step): a split always
has its join, and nothing can be drawn that the flow cannot hold. The rules of the flows (parallel
branches share no equipment, a result is used only where its step has run, parameter ranges) are
checked as before, by the same code.

A step that runs a skill has an open icon: it opens that skill in the AAS viewer, and there in the
skill editor. From a plan's step to the module's skill, and from a skill's step to the component's
skill it runs, in the same notation. A call's icon opens the sequence it calls.

**BPMN** downloads the flow as a BPMN 2.0 file (XML with its diagram) for bpmn.io or Camunda
Modeler. It is marked not executable: a skill runs in the module's control program, a plan is
carried out by the line's agents. A decision's otherwise is the split's default flow, its condition
a condition expression; what a step runs and is handed is in the task's extension elements
(namespace `https://smartproductionlab.aau.dk/bpmn/1/0`).

## Where it is

- `index.vue`: the module (menu entry "Process Sequence (BPMN)"): the Process Sequence module's
  `PlanEditor` with `PlanBpmnGraph` as its graph.
- `bpmn/bpmnLayout.ts`: the flow as BPMN shapes and sequence flows, laid out; where a step inserted
  on a flow goes. `bpmn/bpmnXml.ts`: the BPMN 2.0 file. `bpmn/bpmnGraph.ts`: the layout for Vue Flow.
- `bpmn/BpmnFlowGraph.vue`, `bpmn/BpmnShape.vue`: the graph, with the contract of `SkillFlowGraph` and
  `PlanGraph` (the steps as its model, the selected one in and out).
- The skill editor in BPMN notation is the plugin `components/Plugins/SubmodelElements/ArsoSkillBpmn_v1_0.vue`:
  `SkillEditor` with `BpmnFlowGraph` as its graph.

## Which skill editor shows

`VITE_SKILL_EDITOR` (`classic`, `bpmn` or `both`; `both` when unset) is the default; the toggle in the
BPMN editor's header changes it for the browser (kept in localStorage). With `bpmn` the classic
editor is not shown; with `classic` only the toggle is, to bring the BPMN editor back.
