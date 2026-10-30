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

## Drawing

**Catalog** in the toolbar opens a panel over the canvas's left edge (closed by default, kept open or
closed per browser; the canvas keeps the editor's full width). It holds what can be put in the flow: the product's process steps and its
subprocesses (planner), the skills of the module's components by component (skill editor), the
gateways, and an empty step. Drag an item onto an arrow to insert it there, onto a shape to put it
after that shape, or onto the empty canvas to place it freely; a double-click or Enter inserts it on
the selected arrow, after the selected shape, or at the end. A parallel block, a decision and
conditional steps come as a split with its join; a single gateway is there to wire by hand.

Wire from a shape's right dot to another shape; drag an arrow's end to another shape to rewire it.
Drag a step onto an arrow to move it there. Delete removes the selection (a gateway of a block
removes the whole block, closing the line), Ctrl+Z and Ctrl+Y undo and redo. On an arrow out of an
exclusive gateway, **Make otherwise** makes it the default flow. The (i) in the toolbar says this in short.

**Auto layout** (on by default, kept per browser) lays the diagram out after each change, as the
flow's structure says: the first branch of a block along the line, the others below it. Off, shapes
stay where they are put, and what snaps onto an arrow goes onto its line with room made for it;
**Tidy up** lays out once.

## The validator

The drawing is free, the flow is not: after each change the drawing is read back into the flow
(`bpmn/bpmnDiagram.ts`, `flowFromDiagram`). It is one if it runs once from Start to End; a task has
one way in and one way out; a gateway either splits (one in, several out) or joins (several in, one
out); the branches of a split meet at one join of its kind and nothing else enters there; an
exclusive split has two ways out, one of them otherwise. What breaks a rule is listed under the canvas
and marked on its shapes; a listed issue shows its shapes when clicked.

While the drawing is not a flow, the editor keeps the last flow that was, and Save is off. An exclusive
split whose otherwise is empty stays a conditional flow if it was one; with steps on its otherwise it
becomes a decision, its condition kept. The checks of the flow itself (equipment, results, parameter
ranges) run on it as before; in the skill editor the skill service's checker also runs by itself a
moment after each change (the chip next to the skill's name).

## Export

**BPMN** downloads the flow as a BPMN 2.0 file (XML with its diagram) for bpmn.io or Camunda
Modeler. It is marked not executable: a skill runs in the module's control program, a plan is
carried out by the line's agents. A decision's otherwise is the split's default flow, its condition
a condition expression; what a step runs and is handed is in the task's extension elements
(namespace `https://smartproductionlab.aau.dk/bpmn/1/0`).

## Where it is

- `index.vue`: the module (menu entry "Process Sequence (BPMN)"): the Process Sequence module's
  `PlanEditor` with `PlanBpmnGraph` as its graph.
- `bpmn/bpmnLayout.ts`: the flow as BPMN shapes and sequence flows, laid out. `bpmn/bpmnXml.ts`: the
  BPMN 2.0 file. `bpmn/bpmnGraph.ts`: the drawing for Vue Flow.
- `bpmn/bpmnDiagram.ts`: the drawing (shapes, flows, where they are), drawn from the flow and read back
  into it (the validator), laid out. `bpmn/bpmnEdit.ts`: its edits (insert on a flow, wire, rewire,
  remove, move onto a flow). `bpmn/bpmnRoute.ts`: an arrow's orthogonal route.
- `bpmn/bpmnCatalog.ts`, `bpmn/BpmnPalette.vue`: the catalog.
- `bpmn/BpmnFlowGraph.vue`, `bpmn/BpmnShape.vue`, `bpmn/BpmnEdge.vue`: the graph, with the contract of
  `SkillFlowGraph` and `PlanGraph` (the steps as its model, the selected one in and out), and
  `issues`: what keeps the drawing from being a flow.
- The skill editor in BPMN notation is the plugin `components/Plugins/SubmodelElements/ArsoSkillBpmn_v1_0.vue`:
  `SkillEditor` with `BpmnFlowGraph` as its graph.

## Which skill editor shows

`VITE_SKILL_EDITOR` (`classic`, `bpmn` or `both`; `both` when unset) is the default; the toggle in the
BPMN editor's header changes it for the browser (kept in localStorage). With `bpmn` the classic
editor is not shown; with `classic` only the toggle is, to bring the BPMN editor back.
