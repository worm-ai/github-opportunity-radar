import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd(), work = resolve(root, '.data/experiments/microverse-behavior');
const execution = JSON.parse(readFileSync(resolve(work, 'latest.json'), 'utf8')).execution;
const read = name => JSON.parse(readFileSync(resolve(execution, name), 'utf8'));
const result = read('result.json'), write = read('write.json'), load = read('load.json');
assert.equal(result.commit, '7a061d41ed67825496588e39ca37b0b2b7465fb2');
assert.equal(result.driverSha256, createHash('sha256').update(readFileSync('experiments/microverse-behavior/probe.gd')).digest('hex'));
assert.equal(result.verifiedFiles, 4407);
assert.deepEqual(result.changedUpstreamFiles, []);
for (const name of ['import', 'write', 'load']) {
  const stage = result.stages.find(item => item.name === name);
  assert.equal(stage.code, 0, `${name} did not complete`);
  assert.equal(stage.timedOut, false);
}
for (const output of [write, load]) {
  assert.equal(output.error, undefined);
  assert.ok(output.characters.includes('Alice') && output.characters.length > 1);
  assert.ok(output.stopped_ai_timers >= output.characters.length * 2);
  assert.deepEqual(output.http_request_nodes_created, []);
}
assert.ok(write.after_default_tasks.tasks_metadata.length > 0);
assert.equal((write.after_default_tasks.character_data.tasks ?? []).length, 0);
assert.equal(write.before_complete.character_data.tasks[0].completed, false);
assert.equal(write.after_complete.character_data.tasks[0].completed, true);
assert.equal(write.after_complete.tasks_metadata[0].completed, false);
assert.ok(write.task_prompt_after_complete.includes('REPRO_TASK_SHARE_WATER'));
assert.ok(write.prompt_before_complete.includes('REPRO_SHARED_EVENT_WATER_SHORTAGE'));
assert.ok(write.prompt_before_complete.includes('Bob'));
assert.equal(write.placeholder_tasks_changed, false);
assert.equal(write.placeholder_tasks_metadata_changed, false);
assert.deepEqual(write.save_group_characters, []);
assert.equal(write.save_return, true);
assert.deepEqual(write.save_file, {});
assert.equal(load.load_return, false);
assert.deepEqual(write.before_save.position, { x: 333, y: 444 });
assert.notDeepEqual(load.after_load.position, write.before_save.position);
assert.deepEqual(load.after_load.character_data, {});
assert.deepEqual(load.after_load.tasks_metadata, []);
assert.deepEqual(load.after_load.relations_metadata, {});
assert.equal(write.controller_has_property_method, false);
assert.deepEqual(write.direct_character_collection, {});
const errors = readFileSync(resolve(execution, 'write.stderr.txt'), 'utf8');
assert.ok(errors.includes("Nonexistent function 'has_property' in base 'Node2D (Room)'"));
assert.ok(errors.includes("Nonexistent function 'has_property' in base 'CharacterBody2D (CharacterController.gd)'"));
const check = {
  verifiedAt: new Date().toISOString(), execution, originalFilesUnchanged: result.verifiedFiles,
  characters: write.characters, stoppedAiTimers: write.stopped_ai_timers,
  taskContainersDiverge: true, completionPromptStillContainsTask: true,
  memoryAndRelationshipPresentInPrompt: true, placeholderTasksChanged: false,
  saveGroup: write.save_group_characters, saveReturn: write.save_return,
  saveFile: write.save_file, loadReturn: load.load_return,
  positionBeforeSave: write.before_save.position,
  restoredPosition: load.after_load.position,
  restoredMemories: load.after_load.character_data.memories ?? [],
  restoredTasks: load.after_load.tasks_metadata,
  restoredRelationships: load.after_load.relations_metadata,
  httpRequestNodesCreated: [],
};
writeFileSync(resolve(execution, 'verification.json'), JSON.stringify(check, null, 2));
console.log(JSON.stringify(check, null, 2));
