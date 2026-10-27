extends SceneTree

var output: Dictionary = {}
var http_request_nodes: Array = []

func _initialize():
	node_added.connect(func(node):
		if node is HTTPRequest:
			http_request_nodes.append(str(node.name))
	)
	call_deferred("_run")

func character_snapshot(character):
	return {
		"name": str(character.name),
		"position": {"x": character.global_position.x, "y": character.global_position.y},
		"character_data": character.get_meta("character_data", {}).duplicate(true),
		"tasks_metadata": character.get_meta("tasks", []).duplicate(true),
		"memories_metadata": character.get_meta("memories", []).duplicate(true),
		"relations_metadata": character.get_meta("relations", {}).duplicate(true)
	}

func _run():
	var phase = OS.get_environment("MICROVERSE_PHASE")
	output = {"phase": phase, "engine": Engine.get_version_info(), "scope": "Original Office scene and upstream methods; AI timers stopped; no model calls."}
	var packed = load("res://scene/maps/Office.tscn")
	if not packed:
		finish({"error": "Office scene could not load"}, 2)
		return
	var scene = packed.instantiate()
	root.add_child(scene)
	current_scene = scene
	var characters = get_nodes_in_group("controllable_characters")
	output["characters"] = []
	output["stopped_ai_timers"] = 0
	# Stop every AI timer before yielding a frame. Do not invoke model decisions.
	for character in characters:
		output["characters"].append(str(character.name))
		var agent = character.get("ai_agent")
		if agent:
			for child in agent.get_children():
				if child is Timer:
					child.stop()
					output["stopped_ai_timers"] += 1
	await process_frame
	await process_frame
	var alice = scene.find_child("Alice", true, false)
	if not alice:
		finish({"error": "Alice not found"}, 3)
		return
	var agent = alice.get("ai_agent")
	var memory = root.get_node_or_null("MemoryManager")
	var saves = root.get_node_or_null("GameSaveManager")
	if not agent or not memory or not saves:
		finish({"error": "Required original component missing"}, 4)
		return
	output["save_group_characters"] = get_nodes_in_group("character").map(func(item): return str(item.name))
	output["agent_node_name"] = str(agent.name)
	output["controller_has_property_method"] = alice.has_method("has_property")
	if phase == "write":
		alice.set_meta("last_task_refresh", Time.get_unix_time_from_system())
		alice.set_meta("character_data", {})
		agent._generate_default_tasks(alice)
		output["after_default_tasks"] = character_snapshot(alice)
		var task = {"description": "REPRO_TASK_SHARE_WATER", "priority": 9, "completed": false, "created_at": 1234567.0}
		alice.set_meta("tasks", [task.duplicate(true)])
		alice.set_meta("character_data", {"tasks": [task.duplicate(true)], "memories": []})
		alice.set_meta("relations", {"Bob": {"type": "friend", "strength": 7}})
		memory.add_memory(alice, "REPRO_SHARED_EVENT_WATER_SHORTAGE", memory.MemoryType.EVENT, memory.MemoryImportance.HIGH)
		output["before_complete"] = character_snapshot(alice)
		output["prompt_before_complete"] = agent.get_character_status_info(alice)
		agent._complete_task(alice, task)
		output["after_complete"] = character_snapshot(alice)
		output["task_prompt_after_complete"] = agent.get_character_task_info(alice)
		var before = character_snapshot(alice)
		agent._rearrange_task_priorities(alice)
		agent._add_urgent_task(alice)
		output["placeholder_tasks_changed"] = before.character_data.tasks != alice.get_meta("character_data").tasks
		output["placeholder_tasks_metadata_changed"] = before.tasks_metadata != alice.get_meta("tasks", [])
		output["after_placeholders"] = character_snapshot(alice)
		alice.global_position = Vector2(333, 444)
		output["before_save"] = character_snapshot(alice)
		output["save_return"] = saves.save_game("behavior-probe")
		output["save_data"] = saves.current_save_data.duplicate(true)
		# Separate diagnostic: the default save group may omit every character.
		# Call the original collector without adding characters to that group.
		output["direct_character_collection"] = saves.collect_character_data(alice)
		var file = FileAccess.open("user://saves/behavior-probe.json", FileAccess.READ)
		output["save_file"] = JSON.parse_string(file.get_as_text()) if file else null
		output["user_directory"] = OS.get_user_data_dir()
	else:
		output["before_load"] = character_snapshot(alice)
		output["load_return"] = saves.load_game("behavior-probe")
		output["after_load"] = character_snapshot(alice)
	finish({}, 0)

func finish(extra: Dictionary, code: int):
	output.merge(extra)
	output["http_request_nodes_created"] = http_request_nodes
	var file = FileAccess.open(OS.get_environment("MICROVERSE_OUTPUT"), FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(output, "\t"))
		file.close()
	quit(code)
